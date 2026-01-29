import json
from datetime import datetime
from typing import Optional, Dict
from uuid import uuid4

from PyQt6.QtCore import pyqtSignal, Qt, QModelIndex, QRect, QSize, QTimer, QEvent
from PyQt6.QtGui import QColor, QPainter, QBrush, QPen, QPalette, QStandardItemModel
from PyQt6.QtWidgets import QTreeWidget, QAbstractItemView, QHeaderView, QStyledItemDelegate, QStyleOptionViewItem, \
    QStyle, QWidget, QLineEdit, QTreeWidgetItem, QFrame, QVBoxLayout, QHBoxLayout, QLabel, QToolButton, QMenu, \
    QApplication, QPlainTextEdit
from pydantic import BaseModel

from Z_Corpus_analysis.Editor import HtmlPreviewDialog
from Z_Corpus_analysis.help_functions import _sanitize_filename
from bibliometric_analysis_tool.core.app_constants import MIME_PAYLOAD, ROLE_NODE_ID, ROLE_PAYLOAD, ROLE_IS_FOLDER, \
    ROLE_STATUS, STATUS_INCLUDE, STATUS_MAYBE, ROLE_NOTE, collection_cache_dir, STATUS_EXCLUDE, ROLE_EDITED_HTML, \
    APP_SESSION_DIR
from bibliometric_analysis_tool.core.common_styles import add_soft_shadow


class CoderItemDelegate(QStyledItemDelegate):
    """
    Premium paint + editing behavior:
      - Soft rounded row backgrounds on hover/selection.
      - Right-side pill for Include/Maybe/Exclude (items only).
      - Double-click a FOLDER -> editor opens with EMPTY text but placeholder shows the old title.
        If you confirm with no change (empty or same), we restore the old title.
      - Editor spans the full row width and won't shrink while typing.
    """

    def __init__(self, tree, accent_hex="#7DD3FC"):
        super().__init__(tree)
        self._accent = QColor(accent_hex)
        self._pill_inc = QColor("#16A34A")  # Include
        self._pill_mb = QColor("#F59E0B")  # Maybe
        self._pill_ex = QColor("#EF4444")  # Exclude
        self._hover_bg = QColor(255, 255, 255, 30)
        self._sel_bg = QColor(self._accent.red(), self._accent.green(), self._accent.blue(), 40)
        self._sel_br = QColor(self._accent.red(), self._accent.green(), self._accent.blue(), 70)

    # ---- paint ----
    def paint(self, painter: QPainter, option: QStyleOptionViewItem, index: QModelIndex) -> None:
        painter.save()

        # base rect (inner padding)
        r = option.rect.adjusted(2, 1, -2, -1)

        # row background
        if option.state & QStyle.StateFlag.State_Selected:
            painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
            painter.setPen(QPen(self._sel_br, 1))
            painter.setBrush(QBrush(self._sel_bg))
            painter.drawRoundedRect(r, 8, 8)
        elif option.state & QStyle.StateFlag.State_MouseOver:
            painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(QBrush(self._hover_bg))
            painter.drawRoundedRect(r, 8, 8)

        # text (leave space for status pill on the right)
        text = index.data(Qt.ItemDataRole.DisplayRole) or ""
        is_folder = bool(index.data(ROLE_IS_FOLDER))
        painter.setPen(option.palette.color(QPalette.ColorRole.Text))
        text_rect = r.adjusted(10, 2, -110 if not is_folder else -10, -2)
        painter.drawText(text_rect, Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft, text)

        # status pill for item rows
        if not is_folder:
            status = (index.data(ROLE_STATUS) or "").lower()
            if status == STATUS_INCLUDE:
                pill_color, pill_text = self._pill_inc, "Included"
            elif status == STATUS_MAYBE:
                pill_color, pill_text = self._pill_mb, "Maybe"
            else:
                pill_color, pill_text = self._pill_ex, "Excluded"

            pill_rect = QRect(r.right() - 96, r.top() + 6, 88, r.height() - 12)
            painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(QBrush(pill_color.lighter(120)))
            painter.drawRoundedRect(pill_rect, 10, 10)
            painter.setPen(Qt.GlobalColor.white)
            painter.drawText(pill_rect, Qt.AlignmentFlag.AlignCenter, pill_text)

        painter.restore()

    def sizeHint(self, option: QStyleOptionViewItem, index: QModelIndex) -> QSize:
        base = super().sizeHint(option, index)
        # Slightly taller rows feel more premium and help the inline editor
        return QSize(base.width(), max(28, base.height()))

    # ---- editing ----
    def createEditor(self, parent: QWidget, option: QStyleOptionViewItem, index: QModelIndex) -> QWidget:
        is_folder = bool(index.data(ROLE_IS_FOLDER))
        editor = QLineEdit(parent)
        editor.setObjectName("CoderInlineEditor")
        f = editor.font()
        f.setPointSizeF(max(10.0, f.pointSizeF()))
        editor.setFont(f)
        # expand to full row width; don't collapse while typing
        editor.setMinimumHeight(max(26, option.rect.height()))
        editor.setContentsMargins(0, 0, 0, 0)

        # Folder rename UX: clear text but show old title as placeholder
        if is_folder:
            old = index.data(Qt.ItemDataRole.DisplayRole) or ""
            editor.setProperty("origText", old)
            editor.setPlaceholderText(old)
            editor.setText("")  # cleared for typing
            editor.selectAll()  # and focused selection
        else:
            # items edit normally
            editor.setText(index.data(Qt.ItemDataRole.DisplayRole) or "")

        return editor

    class _EditResult(BaseModel):
        text: str

    def setModelData(self, editor: QLineEdit, model: QStandardItemModel, index: QModelIndex) -> None:
        """
        Handles text edits for both folder and non-folder items, ensuring the model receives
        validated Pydantic-wrapped data and eliminating unresolved references.
        """

        class EditResult(BaseModel):
            text: str

        is_folder: bool = bool(index.data(ROLE_IS_FOLDER))
        raw_text: str = editor.text() if isinstance(editor, QLineEdit) else ""
        new_text: str = raw_text.strip()

        if is_folder:
            orig_prop = editor.property("origText")
            orig: str = (orig_prop if isinstance(orig_prop, str) else "").strip()
            final_text: str = orig if (not new_text or new_text == orig) else new_text
            model.setData(index, final_text)
            return

        current_display: Optional[str] = index.data(Qt.ItemDataRole.DisplayRole)
        final_text: str = new_text or (current_display or "")
        payload = EditResult(text=final_text)
        model.setData(index, payload.text)

    def updateEditorGeometry(self, editor: QWidget, option: QStyleOptionViewItem, index: QModelIndex) -> None:
        # Stretch editor to the full inner rect
        editor.setGeometry(option.rect.adjusted(6, 2, -6, -2))
class CoderTree(QTreeWidget):
    payloadDropped = pyqtSignal(dict)
    structureChanged = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("CoderTree")  # for QSS
        self.setHeaderHidden(True)
        self.setIndentation(16)
        self.setAnimated(True)
        self.setExpandsOnDoubleClick(True)

        self.setDragEnabled(True)
        self.setAcceptDrops(True)
        self.viewport().setAcceptDrops(True)
        self.setDropIndicatorShown(True)

        self.setDefaultDropAction(Qt.DropAction.MoveAction)
        self.setDragDropMode(QAbstractItemView.DragDropMode.DragDrop)


        self.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        self.setMouseTracking(True)
        self.setUniformRowHeights(False)

        # Hide the default branch gizmos (“strange square”) and let the delegate paint the row chrome
        self.setRootIsDecorated(False)
        try:
            hdr = self.header()
            hdr.setStretchLastSection(True)
            hdr.setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
            hdr.setMinimumSectionSize(200)
        except Exception:
            pass

        # Premium stylesheet for the tree (harmonized with app)
        self.setStyleSheet("""
        /* Remove native branch glyphs */
        QTreeView::branch { background: transparent; image: none; }
        QTreeView { background: transparent; border: none; outline: 0; }
        QTreeView::item { padding: 6px 8px; }
        QTreeView::item:selected { background: transparent; } /* delegate draws bg */
        QTreeView::item:hover { background: transparent; }    /* delegate draws bg */
        QScrollBar:vertical, QScrollBar:horizontal {
            background: transparent; border: none; margin: 0;
        }
        QScrollBar::handle:vertical, QScrollBar::handle:horizontal {
            background: rgba(15, 23, 42, 30%); min-height: 22px; min-width: 22px;
            border-radius: 6px;
        }
        QScrollBar::add-line, QScrollBar::sub-line { height: 0; width: 0; }
        QLineEdit#CoderInlineEditor {
            background: rgba(255,255,255,0.85);
            border: 1px solid rgba(125,211,252,0.6);
            border-radius: 8px;
            padding: 4px 8px;
        }
        """)

        # Delegate (premium paint + edit UX)
        self.setItemDelegate(CoderItemDelegate(self))

        # Enable convenient renaming:
        self.setEditTriggers(
            QAbstractItemView.EditTrigger.EditKeyPressed
            | QAbstractItemView.EditTrigger.SelectedClicked
            | QAbstractItemView.EditTrigger.DoubleClicked
        )

        # Auto-expand hovered folder when dragging over it
        self._hover_timer = QTimer(self)
        self._hover_timer.setInterval(350)
        self._hover_timer.setSingleShot(True)
        self._hover_timer.timeout.connect(self._expand_hover_target)
        self._hover_target = None

        try:
            self.model().rowsMoved.connect(lambda *a, **k: self.structureChanged.emit())
            self.model().rowsInserted.connect(lambda *a, **k: self.structureChanged.emit())
            self.model().rowsRemoved.connect(lambda *a, **k: self.structureChanged.emit())
        except Exception:
            pass

    def _expand_hover_target(self):
        it = self._hover_target
        if isinstance(it, QTreeWidgetItem) and self.is_folder(it) and not it.isExpanded():
            it.setExpanded(True)

    def _collapse_hover_target(self):
        it = self._hover_target
        if isinstance(it, QTreeWidgetItem) and self.is_folder(it) and it.isExpanded():
            it.setExpanded(False)

    def dragEnterEvent(self, e):
        if e.source() is self:
            e.setDropAction(Qt.DropAction.MoveAction)
            e.acceptProposedAction()
            return
        md = e.mimeData()
        if md.hasFormat(MIME_PAYLOAD) or md.hasHtml() or md.hasText():
            e.setDropAction(Qt.DropAction.CopyAction)
            e.accept()
            return
        e.ignore()

    def is_folder(self, it: QTreeWidgetItem | None) -> bool:
        return bool(it and it.data(0, ROLE_IS_FOLDER))

    def ensure_node_id(self, it: QTreeWidgetItem) -> str:
        nid = it.data(0, ROLE_NODE_ID)
        if not nid:
            import uuid
            nid = uuid.uuid4().hex
            it.setData(0, ROLE_NODE_ID, nid)
        return nid

    def node_id(self, it: QTreeWidgetItem | None) -> str | None:
        return None if it is None else (it.data(0, ROLE_NODE_ID) or None)

    def is_payload_item(self, it: QTreeWidgetItem | None) -> bool:
        return bool(it and (not self.is_folder(it)) and it.data(0, ROLE_PAYLOAD))

    def dragMoveEvent(self, e):
        if e.source() is self:
            e.setDropAction(Qt.DropAction.MoveAction)
            e.acceptProposedAction()
            return

        pos = e.position().toPoint()
        tgt = self.itemAt(pos)
        if tgt and not self.is_folder(tgt):
            tgt = tgt.parent()
        if tgt is None:
            tgt = self.invisibleRootItem()

        if tgt is not self._hover_target:
            self._hover_target = tgt
            self._hover_timer.stop()
            self._hover_timer.start()

        md = e.mimeData()
        if md.hasFormat(MIME_PAYLOAD) or md.hasHtml() or md.hasText():
            e.setDropAction(Qt.DropAction.CopyAction)
            e.accept()
            return

        e.ignore()

    def dropEvent(self, e):
        if e.source() is self:
            super().dropEvent(e)
            return

        import re
        import html as _html

        pos = e.position().toPoint()
        tgt = self.itemAt(pos)
        if tgt and not self.is_folder(tgt):
            tgt = tgt.parent()
        if tgt is None:
            tgt = self.invisibleRootItem()

        md = e.mimeData()
        print("[CODER][DROP] formats=", list(md.formats()))
        print("[CODER][DROP] has_mime_payload=", bool(md.hasFormat(MIME_PAYLOAD)))
        payload = {}

        def _strip_qt_to_fragment(src: str) -> str:
            s = (src or "").strip()
            if s == "":
                return ""

            a = s.find("<!--StartFragment-->")
            b = s.find("<!--EndFragment-->")
            if a >= 0 and b > a:
                return s[a + len("<!--StartFragment-->"):b].strip()

            lo = s.lower()
            i = lo.find("<body")
            if i >= 0:
                j = lo.find(">", i)
                k = lo.rfind("</body>")
                if j >= 0 and k > j:
                    return s[j + 1:k].strip()

            s2 = re.sub(r"(?is)<!doctype.*?>", "", s).strip()
            s2 = re.sub(r"(?is)<html.*?>", "", s2).strip()
            s2 = re.sub(r"(?is)</html\s*>", "", s2).strip()
            s2 = re.sub(r"(?is)<head.*?>.*?</head\s*>", "", s2).strip()
            s2 = re.sub(r"(?is)<body.*?>", "", s2).strip()
            s2 = re.sub(r"(?is)</body\s*>", "", s2).strip()
            return s2.strip()

        def _rehydrate_anchor_attrs_with_meta(src: str, meta_map: dict) -> str:
            s = src or ""
            if s.strip() == "":
                return s

            def _fix_one(m):
                tag = m.group(0)
                lo = tag.lower()

                mh = re.search(r'(?is)\bhref\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))', tag)
                if mh is None:
                    return tag

                href = (mh.group(1) or mh.group(2) or mh.group(3) or "").strip()
                if href == "":
                    return tag

                meta = None

                if href in meta_map:
                    meta = meta_map[href]

                if meta is None and href.startswith("dq://"):
                    stripped = href[len("dq://"):].strip()
                    if stripped != "" and stripped in meta_map:
                        meta = meta_map[stripped]

                if meta is None and (not href.startswith("dq://")):
                    stable = "dq://" + href
                    if stable in meta_map:
                        meta = meta_map[stable]

                if meta is None:
                    keys = list(meta_map.keys())
                    j = 0
                    while j < len(keys):
                        k0 = keys[j]
                        m0 = meta_map[k0]
                        if (m0.get("data-key") or "") == href:
                            meta = m0
                            href = k0
                            break
                        if (m0.get("data-orig-href") or "") == href:
                            meta = m0
                            href = k0
                            break
                        j += 1

                if meta is None:
                    print("[CODER][DROP][ANCHOR] no_meta_for_href=", repr(href), "tag=", tag.replace("\n", " "))
                    raise KeyError(href)

                out = tag[:-1]

                if ' data-key=' not in lo:
                    out = out + ' data-key="' + href.replace('"', "&quot;") + '"'

                if meta.get("data-dqid") and ' data-dqid=' not in lo:
                    out = out + ' data-dqid="' + str(meta["data-dqid"]).replace('"', "&quot;") + '"'

                if meta.get("data-quote-id") and ' data-quote-id=' not in lo:
                    out = out + ' data-quote-id="' + str(meta["data-quote-id"]).replace('"', "&quot;") + '"'

                if meta.get("data-quote_id") and ' data-quote_id=' not in lo:
                    out = out + ' data-quote_id="' + str(meta["data-quote_id"]).replace('"', "&quot;") + '"'

                if meta.get("data-orig-href") and ' data-orig-href=' not in lo:
                    out = out + ' data-orig-href="' + str(meta["data-orig-href"]).replace('"', "&quot;") + '"'

                if ' title=' not in lo:
                    t = meta.get("title") or meta.get("data-orig-href") or href
                    esc = str(t).replace("&", "&amp;").replace('"', "&quot;")
                    out = out + ' title="' + esc + '"'

                out = out + ">"
                return out

            return re.sub(r"(?is)<a\b[^>]*>", _fix_one, s)

        if md.hasFormat(MIME_PAYLOAD):
            blob = bytes(md.data(MIME_PAYLOAD)).decode("utf-8").strip()
            payload = json.loads(blob) if blob else {}

            print("\n[CODER][DROP] via MIME_PAYLOAD")
            print("[CODER][DROP] payload_text=", repr(payload.get("text")))
            print("[CODER][DROP] payload_html_head=", repr((payload.get("html") or "")[:400]))

            html_before = str(payload.get("html") or "")
            a0 = re.findall(r'(?is)<a\b[^>]*>', html_before)
            if a0:
                print("[CODER][DROP] A_in=", a0[0].replace("\n", " "))

            meta_map = payload.get("anchor_meta") or {}
            if meta_map:
                print("[CODER][DROP] anchor_meta_keys_sample=", list(meta_map.keys())[:5])

            if meta_map:
                payload["html"] = _rehydrate_anchor_attrs_with_meta(html_before, meta_map)

                html_after = str(payload.get("html") or "")
                a1 = re.findall(r'(?is)<a\b[^>]*>', html_after)
                if a1:
                    print("[CODER][DROP] A_rehydrated=", a1[0].replace("\n", " "))

        if (not payload) and md.hasHtml():
            from PyQt6.QtWidgets import QApplication

            html_src = bytes(md.data("text/html")).decode("utf-8").strip()
            txt = md.text().strip()

            print("\n[CODER][DROP] via text/html")
            print("[CODER][DROP] html_head=", repr(html_src[:400]))
            a0 = re.findall(r'(?is)<a\b[^>]*>', html_src)
            if a0:
                print("[CODER][DROP] A_in=", a0[0].replace("\n", " "))

            anchor_idx = QApplication.instance().property("_drag_anchor_index")

            def _rehydrate_anchor_attrs(src: str) -> str:
                s = src or ""
                if s.strip() == "":
                    return s

                def _fix_one(m):
                    tag = m.group(0)
                    lo = tag.lower()

                    mh = re.search(r'(?is)\bhref\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))', tag)
                    if mh is None:
                        return tag

                    href = (mh.group(1) or mh.group(2) or mh.group(3) or "").strip()
                    if href == "":
                        return tag

                    meta = anchor_idx.get(href) if anchor_idx else None

                    out = tag[:-1]

                    if " data-key=" not in lo:
                        out = out + ' data-key="' + href.replace('"', "&quot;") + '"'

                    if meta:
                        dqid = meta.get("dqid") or ""
                        if dqid and (" data-dqid=" not in lo) and (" data-quote-id=" not in lo) and (
                                " data-quote_id=" not in lo):
                            out = out + ' data-dqid="' + str(dqid).replace('"', "&quot;") + '"'

                        if " title=" not in lo:
                            t = meta.get("title") or href
                            esc = str(t).replace("&", "&amp;").replace('"', "&quot;")
                            out = out + ' title="' + esc + '"'
                            print("[CODER][DROP] title_missing -> injected title=meta_or_href", repr(t))
                            print("[CODER][DROP] A_out=", (out + ">").replace("\n", " "))
                    else:
                        if " title=" not in lo:
                            esc = href.replace("&", "&amp;").replace('"', "&quot;")
                            out = out + ' title="' + esc + '"'
                            print("[CODER][DROP] title_missing -> injected title=href", repr(href))
                            print("[CODER][DROP] A_out=", (out + ">").replace("\n", " "))

                    out = out + ">"
                    return out

                return re.sub(r"(?is)<a\b[^>]*>", _fix_one, s)

            payload = {
                "title": (txt[:80].rstrip() + "…") if len(txt) > 80 else (txt or "Selection"),
                "text": txt,
                "html": _rehydrate_anchor_attrs(html_src),
                "source": {"scope": "dragdrop"},
            }

        if (not payload) and md.hasText():
            txt = md.text().strip()
            payload = {
                "title": (txt[:80].rstrip() + "…") if len(txt) > 80 else (txt or "Selection"),
                "text": txt,
                "html": "<p>" + _html.escape(txt).replace("\n", "<br/>") + "</p>",
                "source": {"scope": "dragdrop"},
            }

            print("\n[CODER][DROP] via text/plain")
            print("[CODER][DROP] text=", repr(txt))

        if payload:
            html_src = payload.get("html") or payload.get("section_html") or ""
            txt = payload.get("text") or payload.get("title") or ""
            frag = _strip_qt_to_fragment(str(html_src))

            if frag.strip():
                f = frag.strip()

                # Strip Qt "empty paragraph" blocks and collapse long runs of blank <p> to a single <p></p>.
                f = re.sub(r'(?is)<p\b[^>]*-qt-paragraph-type:\s*empty[^>]*>\s*</p>', '', f)
                f = re.sub(
                    r'(?is)(<p\b[^>]*>\s*(?:&nbsp;|\s|<span\b[^>]*>\s*(?:&nbsp;|\s)*</span>)*\s*</p>\s*){2,}',
                    '<p></p>',
                    f
                )

                lo = f.lstrip().lower()
                is_block = (
                        lo.startswith("<p") or lo.startswith("<div") or lo.startswith("<blockquote") or
                        lo.startswith("<ul") or lo.startswith("<ol") or lo.startswith("<pre") or
                        lo.startswith("<h1") or lo.startswith("<h2") or lo.startswith("<h3") or
                        lo.startswith("<h4") or lo.startswith("<h5") or lo.startswith("<h6")
                )
                payload["html"] = f if is_block else ("<p>" + f + "</p>")
            else:
                payload["html"] = "<p>" + _html.escape(str(txt).strip()).replace("\n", "<br/>") + "</p>"

            folder_id = ""
            folder_name = ""
            is_root = False

            if tgt is self.invisibleRootItem():
                is_root = True
            else:
                folder_id = self.ensure_node_id(tgt)
                folder_name = tgt.text(0) or ""

            payload["_coder_target"] = {"node_id": folder_id, "name": folder_name, "is_root": is_root}

            print("[CODER][DROP] final_html_head=", repr((payload.get("html") or "")[:400]))
            a1 = re.findall(r'(?is)<a\b[^>]*>', str(payload.get("html") or ""))
            if a1:
                print("[CODER][DROP] A_final=", a1[0].replace("\n", " "))

            it_new = self.add_payload_node(payload, tgt)

            item_id = self.ensure_node_id(it_new)
            payload["_coder_item_id"] = item_id

            payload["coder_id"] = item_id
            payload["coder_parent_id"] = folder_id

            it_new.setData(0, ROLE_PAYLOAD, payload)

            self.payloadDropped.emit(payload)
            self.structureChanged.emit()
            e.setDropAction(Qt.DropAction.CopyAction)
            e.accept()
            return

        super().dropEvent(e)
        self.structureChanged.emit()

    # ---------- CRUD ----------
    def add_folder(self, name: str, parent: QTreeWidgetItem | None = None) -> QTreeWidgetItem:
        it = QTreeWidgetItem([name or "Section"])
        it.setData(0, ROLE_IS_FOLDER, True)
        it.setData(0, ROLE_NOTE, "")
        it.setFlags(it.flags()
                    | Qt.ItemFlag.ItemIsEditable
                    | Qt.ItemFlag.ItemIsDropEnabled
                    | Qt.ItemFlag.ItemIsEnabled
                    | Qt.ItemFlag.ItemIsSelectable
                    | Qt.ItemFlag.ItemIsDragEnabled)
        (parent or self.invisibleRootItem()).addChild(it)
        self.ensure_node_id(it)
        self.expandItem(it)
        self.structureChanged.emit()
        return it

    def add_subfolder(self, parent: QTreeWidgetItem | None):
        if not (parent and self.is_folder(parent)):
            parent = None
        return self.add_folder("New section", parent)

    def add_payload_node(self, payload: dict, parent: QTreeWidgetItem | None):
        title = (
                (payload.get("paraphrase") or "")
                or (payload.get("direct_quote") or "")
                or (payload.get("title") or "")
                or (payload.get("text") or "")
        ).strip()

        if title == "":
            title = "Selection"

        if len(title) > 80:
            title = title[:80].rstrip() + "…"

        it = QTreeWidgetItem([title])
        it.setData(0, ROLE_IS_FOLDER, False)
        it.setData(0, ROLE_PAYLOAD, payload)
        it.setData(0, ROLE_STATUS, STATUS_INCLUDE)
        it.setFlags(it.flags()
                    | Qt.ItemFlag.ItemIsEnabled
                    | Qt.ItemFlag.ItemIsSelectable
                    | Qt.ItemFlag.ItemIsDragEnabled)
        (parent or self.invisibleRootItem()).addChild(it)
        self.ensure_node_id(it)
        self.structureChanged.emit()
        return it


class CoderPanel(QFrame):
    """
    Organizes dragged items into folders. Persists to base_dir / CODER_STATE_FILE.
    Simplified header (Export only). All other actions via right-click menu.
    Vertical layout: Tree (70%) + Section note (30%).
    """
    payloadSelected = pyqtSignal(dict)
    folderNoteChanged = pyqtSignal(str)

    def __init__(self, parent=None, collection_name="no collection", payload_lookup=None):
        super().__init__(parent)
        self._payload_lookup = payload_lookup
        self.setObjectName("Panel")
        add_soft_shadow(self, 18, 0.22)

        self.collection_name = collection_name
        self.base_dir = collection_cache_dir(collection_name)
        self.state_path = self.base_dir / "coder_state.json"
        self._last_saved_ts: datetime | None = None
        self._last_sync_ts: datetime | None = None

        # ========== Style ==========

        # ========== Layout ==========
        v = QVBoxLayout(self)
        v.setSpacing(8)
        v.setContentsMargins(12, 10, 12, 10)

        hdr = QVBoxLayout()
        hdr.setContentsMargins(0, 0, 0, 0)
        hdr.setSpacing(6)

        row1 = QHBoxLayout()
        row1.setContentsMargins(0, 0, 0, 0)
        row1.setSpacing(8)

        title = QLabel("Coder")
        title.setObjectName("Title")
        row1.addWidget(title, 0)

        self.lbl_save = QLabel("Saved")
        self.lbl_save.setObjectName("CoderSavePill")
        self.lbl_save.setToolTip("State written to disk")
        row1.addWidget(self.lbl_save, 0)

        self.lbl_sync_status = QLabel("")
        self.lbl_sync_status.setObjectName("CoderSyncPill")
        self.lbl_sync_status.setToolTip("Last synced tree snapshot")
        row1.addWidget(self.lbl_sync_status, 0)

        row1.addStretch(1)

        self.btn_toggle_note = QToolButton()
        self.btn_toggle_note.setObjectName("CoderActionBtn")
        self.btn_toggle_note.setToolTip("Show/Hide section note")
        self.btn_toggle_note.setAutoRaise(True)
        self.btn_toggle_note.setText("Note")
        self.btn_toggle_note.setCheckable(True)
        self.btn_toggle_note.setChecked(False)
        row1.addWidget(self.btn_toggle_note, 0)

        hdr.addLayout(row1)
        hdr = QVBoxLayout()
        hdr.setContentsMargins(0, 0, 0, 0)
        hdr.setSpacing(6)

        # -------- Row 1: title + saved pill + note toggle --------
        row1 = QHBoxLayout()
        row1.setContentsMargins(0, 0, 0, 0)
        row1.setSpacing(8)

        title = QLabel("Coder")
        title.setObjectName("Title")
        row1.addWidget(title, 0)

        self.lbl_save = QLabel("Saved")
        self.lbl_save.setObjectName("CoderSavePill")
        self.lbl_save.setToolTip("State written to disk")
        row1.addWidget(self.lbl_save, 0)

        self.lbl_sync_status = QLabel("")
        self.lbl_sync_status.setObjectName("CoderSyncPill")
        self.lbl_sync_status.setToolTip("Last synced tree snapshot")
        row1.addWidget(self.lbl_sync_status, 0)

        row1.addStretch(1)

        self.btn_toggle_note = QToolButton()
        self.btn_toggle_note.setObjectName("CoderActionBtn")
        self.btn_toggle_note.setToolTip("Show/Hide section note")
        self.btn_toggle_note.setAutoRaise(True)
        self.btn_toggle_note.setText("Note")
        self.btn_toggle_note.setCheckable(True)
        self.btn_toggle_note.setChecked(False)
        row1.addWidget(self.btn_toggle_note, 0)

        hdr.addLayout(row1)

        # -------- Row 2: filter ONLY (full width) --------
        row2 = QHBoxLayout()
        row2.setContentsMargins(0, 0, 0, 0)
        row2.setSpacing(8)

        self.txt_filter = QLineEdit()
        self.txt_filter.setObjectName("CoderSearch")
        self.txt_filter.setPlaceholderText("Filter…")
        self.txt_filter.setClearButtonEnabled(True)
        self.txt_filter.setFixedHeight(26)
        row2.addWidget(self.txt_filter, 1)

        self.lbl_filter_status = QLabel("Type to filter")
        self.lbl_filter_status.setObjectName("CoderFilterStatus")
        self.lbl_filter_status.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        row2.addWidget(self.lbl_filter_status, 0)

        hdr.addLayout(row2)

        # -------- Row 3: tools (right-aligned) --------
        row3 = QHBoxLayout()
        row3.setContentsMargins(0, 0, 0, 0)
        row3.setSpacing(8)
        row3.addStretch(1)

        self.btn_new_folder = QToolButton()
        self.btn_new_folder.setObjectName("CoderActionBtn")
        self.btn_new_folder.setToolTip("New folder")
        self.btn_new_folder.setAutoRaise(True)
        self.btn_new_folder.setIcon(self.style().standardIcon(QStyle.StandardPixmap.SP_FileDialogNewFolder))
        row3.addWidget(self.btn_new_folder, 0)

        self.btn_rename = QToolButton()
        self.btn_rename.setObjectName("CoderActionBtn")
        self.btn_rename.setToolTip("Rename")
        self.btn_rename.setAutoRaise(True)
        self.btn_rename.setIcon(self.style().standardIcon(QStyle.StandardPixmap.SP_FileDialogDetailedView))
        row3.addWidget(self.btn_rename, 0)

        self.btn_move_up = QToolButton()
        self.btn_move_up.setObjectName("CoderActionBtn")
        self.btn_move_up.setToolTip("Move selection up")
        self.btn_move_up.setAutoRaise(True)
        self.btn_move_up.setIcon(self.style().standardIcon(QStyle.StandardPixmap.SP_ArrowUp))
        row3.addWidget(self.btn_move_up, 0)

        self.btn_move_down = QToolButton()
        self.btn_move_down.setObjectName("CoderActionBtn")
        self.btn_move_down.setToolTip("Move selection down")
        self.btn_move_down.setAutoRaise(True)
        self.btn_move_down.setIcon(self.style().standardIcon(QStyle.StandardPixmap.SP_ArrowDown))
        row3.addWidget(self.btn_move_down, 0)

        self.btn_delete = QToolButton()
        self.btn_delete.setObjectName("CoderActionBtn")
        self.btn_delete.setToolTip("Delete")
        self.btn_delete.setAutoRaise(True)
        self.btn_delete.setIcon(self.style().standardIcon(QStyle.StandardPixmap.SP_TrashIcon))
        row3.addWidget(self.btn_delete, 0)

        self.btn_status_inc = QToolButton()
        self.btn_status_inc.setObjectName("CoderStatusBtn")
        self.btn_status_inc.setToolTip("Mark Included (1)")
        self.btn_status_inc.setAutoRaise(True)
        self.btn_status_inc.setText("I")
        row3.addWidget(self.btn_status_inc, 0)

        self.btn_status_maybe = QToolButton()
        self.btn_status_maybe.setObjectName("CoderStatusBtn")
        self.btn_status_maybe.setToolTip("Mark Maybe (2)")
        self.btn_status_maybe.setAutoRaise(True)
        self.btn_status_maybe.setText("?")
        row3.addWidget(self.btn_status_maybe, 0)

        self.btn_status_exc = QToolButton()
        self.btn_status_exc.setObjectName("CoderStatusBtn")
        self.btn_status_exc.setToolTip("Mark Excluded (3)")
        self.btn_status_exc.setAutoRaise(True)
        self.btn_status_exc.setText("×")
        row3.addWidget(self.btn_status_exc, 0)

        self.btn_export = QToolButton()
        self.btn_export.setObjectName("CoderExportBtn")
        self.btn_export.setToolTip("Export")
        self.btn_export.setAutoRaise(True)
        self.btn_export.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonIconOnly)
        self.btn_export.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
        self.btn_export.setIcon(self.style().standardIcon(QStyle.StandardPixmap.SP_DialogSaveButton))
        self.btn_export.setFixedSize(28, 28)

        self.menu_export = QMenu(self.btn_export)
        self.act_exp_inc = self.menu_export.addAction("Save HTML: Included only")
        self.act_exp_inc_mb = self.menu_export.addAction("Save HTML: Included + Maybe")
        self.act_exp_all = self.menu_export.addAction("Save HTML: All")
        self.menu_export.addSeparator()
        self.act_copy_inc = self.menu_export.addAction("Copy HTML: Included only")
        self.act_copy_inc_mb = self.menu_export.addAction("Copy HTML: Included + Maybe")
        self.act_copy_all = self.menu_export.addAction("Copy HTML: All")
        self.menu_export.addSeparator()
        self.act_prev_inc = self.menu_export.addAction("Preview: Included only")
        self.act_prev_inc_mb = self.menu_export.addAction("Preview: Included + Maybe")
        self.act_prev_all = self.menu_export.addAction("Preview: All")
        self.btn_export.setMenu(self.menu_export)
        row3.addWidget(self.btn_export, 0)

        hdr.addLayout(row3)

        v.addLayout(hdr)


        self.setStyleSheet(self.styleSheet() + """
        QLabel#CoderSavePill{
            color:#cbd5e1;
            padding:3px 8px;
            border-radius:999px;
            border:1px solid rgba(255,255,255,0.10);
            background: rgba(255,255,255,0.05);
            font-size:12px;
        }
        QLabel#CoderSyncPill{
            color:#94a3b8;
            font-size:11px;
            margin-left:6px;
        }
        QLabel#CoderFilterStatus{
            color:#94a3b8;
            font-size:11px;
        }
        QLabel#CoderHint{
            color:#94a3b8;
            font-size:11px;
            margin-bottom:6px;
        }

        QLineEdit#CoderSearch{
            color:#e5e7eb;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.10);
            border-radius:10px;
            padding:4px 10px;
        }
        QLineEdit#CoderSearch:focus{
            border: 1px solid rgba(147,197,253,0.55);
            background: rgba(255,255,255,0.08);
        }
        QToolButton#CoderActionBtn{
            padding:6px 8px;
            border-radius:10px;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.10);
        }
        QToolButton#CoderActionBtn:hover{ background: rgba(255,255,255,0.10); }
        QToolButton#CoderActionBtn:pressed{ background: rgba(255,255,255,0.14); }

        QToolButton#CoderStatusBtn{
            min-width: 28px;
            padding:6px 0px;
            border-radius:10px;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.10);
            color:#e5e7eb;
            font-weight:650;
        }
        QToolButton#CoderStatusBtn:hover{ background: rgba(255,255,255,0.10); }
        QToolButton#CoderStatusBtn:pressed{ background: rgba(255,255,255,0.14); }

        QToolButton#CoderExportBtn{
            padding:6px;
            border-radius:10px;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.10);
        }
        QToolButton#CoderExportBtn:hover{ background: rgba(255,255,255,0.10); }
        QToolButton#CoderExportBtn:pressed{ background: rgba(255,255,255,0.14); }
        """)

        # Body: vertical (70% tree, 30% note)
        body = QVBoxLayout();
        body.setContentsMargins(0, 0, 0, 0);
        body.setSpacing(8)

        self.tree = CoderTree()
        self.lbl_drag_hint = QLabel("Tip: Drag items to reorder sections or drop them into folders.")
        self.lbl_drag_hint.setObjectName("CoderHint")
        self.lbl_drag_hint.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        self.lbl_drag_hint.setContentsMargins(4, 0, 0, 0)
        body.addWidget(self.lbl_drag_hint, 0)
        body.addWidget(self.tree, 7)

        # Section note (folder-only)
        self.note_box = QFrame()
        self.note_box.setObjectName("Section")
        rlay = QVBoxLayout(self.note_box)
        rlay.setSpacing(0)
        rlay.setContentsMargins(0, 0, 0, 0)

        self.txt_note = QPlainTextEdit()
        self.txt_note.setObjectName("CoderNoteEditor")
        self.txt_note.setPlaceholderText("Write a brief intro for this section…")
        self.txt_note.setTabChangesFocus(True)
        rlay.addWidget(self.txt_note, 1)

        body.addWidget(self.note_box, 2)
        self.note_box.hide()

        v.addLayout(body, 1)

        # Context menu
        self.tree.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.tree.customContextMenuRequested.connect(self._open_menu)

        self.btn_toggle_note.toggled.connect(self._toggle_note_panel)

        # Export actions
        # Export actions (save/copy/preview)
        self.act_exp_inc.triggered.connect(lambda: self.export_selected_to_html(only_status={STATUS_INCLUDE}))
        self.act_exp_inc_mb.triggered.connect(
            lambda: self.export_selected_to_html(only_status={STATUS_INCLUDE, STATUS_MAYBE}))
        self.act_exp_all.triggered.connect(lambda: self.export_selected_to_html(only_status=None))

        self.act_copy_inc.triggered.connect(lambda: self.copy_selected_to_html(only_status={STATUS_INCLUDE}))
        self.act_copy_inc_mb.triggered.connect(
            lambda: self.copy_selected_to_html(only_status={STATUS_INCLUDE, STATUS_MAYBE}))
        self.act_copy_all.triggered.connect(lambda: self.copy_selected_to_html(only_status=None))

        self.act_prev_inc.triggered.connect(lambda: self.preview_selected_html(only_status={STATUS_INCLUDE}))
        self.act_prev_inc_mb.triggered.connect(
            lambda: self.preview_selected_html(only_status={STATUS_INCLUDE, STATUS_MAYBE}))
        self.act_prev_all.triggered.connect(lambda: self.preview_selected_html(only_status=None))

        # Quick actions
        self.btn_new_folder.clicked.connect(lambda: self.tree.add_folder("New section",
                                                                         self._current_item() if self._is_folder(
                                                                             self._current_item()) else None))
        self.btn_rename.clicked.connect(self._rename)
        self.btn_move_up.clicked.connect(lambda: self._move_selected_item(-1))
        self.btn_move_down.clicked.connect(lambda: self._move_selected_item(1))
        self.btn_delete.clicked.connect(self._delete)
        self.btn_status_inc.clicked.connect(lambda: self._set_item_status(self._current_item(), STATUS_INCLUDE))
        self.btn_status_maybe.clicked.connect(lambda: self._set_item_status(self._current_item(), STATUS_MAYBE))
        self.btn_status_exc.clicked.connect(lambda: self._set_item_status(self._current_item(), STATUS_EXCLUDE))

        # Filter
        self.txt_filter.textChanged.connect(self._apply_filter)

        # Selection: show preview + folder note
        self._preview_dlg = None

        self.tree.itemSelectionChanged.connect(self._on_select)

        def _on_item_changed(it: QTreeWidgetItem, _col: int) -> None:
            self._set_saved_pill(False)
            self.save_to_disk()
            if bool(it.data(0, ROLE_IS_FOLDER)):
                fid = str(it.data(0, ROLE_NODE_ID) or "")
                self._sync_default_doc_update_folder_title(fid, it.text(0) or "")
            self._set_saved_pill(True)

        self.tree.itemChanged.connect(_on_item_changed)

        def _on_payload_dropped(p: dict) -> None:
            self._set_saved_pill(False)
            self._append_drop_jsonl(p)
            self.save_to_disk()
            self._sync_default_doc_after_drop(p)
            self._set_saved_pill(True)

        self.tree.payloadDropped.connect(_on_payload_dropped)

        def _on_structure_changed() -> None:
            self._set_saved_pill(False)

            self.save_to_disk()

            # Make every folder/subfolder preview/editor deterministic and in-sync
            self._sync_all_folder_docs_from_tree()

            self._set_saved_pill(True)

        self.tree.structureChanged.connect(_on_structure_changed)


        # Note editor → write to selected folder
        self.txt_note.textChanged.connect(self._on_note_changed_live)

        # Keyboard shortcuts for screening still work (1/2/3)
        self.tree.installEventFilter(self)

        # bootstrap
        if not self.load_from_disk():
            self.tree.add_folder("My collection")
            self.save_to_disk()


    def _toggle_note_panel(self, on: bool) -> None:
        it = self._current_item()
        if not self._is_folder(it):
            self.note_box.hide()
            self.btn_toggle_note.blockSignals(True)
            self.btn_toggle_note.setChecked(False)
            self.btn_toggle_note.blockSignals(False)
            return

        if on:
            self.note_box.show()
        else:
            self.note_box.hide()

    def _on_note_changed_live(self) -> None:
        self._apply_note_to_selection()

    def _refresh_note_panel(self) -> None:
        it = self._current_item()
        is_folder = self._is_folder(it)

        self.txt_note.setEnabled(is_folder)
        self.btn_toggle_note.setEnabled(is_folder)

        if not is_folder:
            self.note_box.hide()
            self.btn_toggle_note.blockSignals(True)
            self.btn_toggle_note.setChecked(False)
            self.btn_toggle_note.blockSignals(False)

            self.txt_note.blockSignals(True)
            self.txt_note.setPlainText("")
            self.txt_note.blockSignals(False)
            return

        note = it.data(0, ROLE_NOTE) or ""
        self.txt_note.blockSignals(True)
        self.txt_note.setPlainText(note or "")
        self.txt_note.blockSignals(False)

        # Do not auto-open the note panel on selection change.
        # Visibility is controlled only by the Note toggle button.

    def _invalidate_edited_html_for_node(self, node_id: str) -> None:
        import json
        from datetime import datetime, timezone

        with open(self.state_path, "r", encoding="utf-8") as f:
            blob = json.load(f)

        nodes = blob["nodes"]

        wanted = str(node_id or "").strip()
        if wanted == "":
            wanted = str(nodes[0]["id"])

        def _walk(lst: list[dict]) -> dict:
            i = 0
            while i < len(lst):
                nd = lst[i]
                if str(nd.get("id") or "") == wanted:
                    return nd
                hit = _walk(nd.get("children") or [])
                if hit:
                    return hit
                i += 1
            return {}

        node = _walk(nodes)
        if str(node.get("id") or "") != wanted:
            raise KeyError(wanted)

        node["edited_html"] = ""
        node["updated_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

        with open(self.state_path, "w", encoding="utf-8") as f:
            json.dump(blob, f, ensure_ascii=False, indent=2)

    def _apply_note_to_selection(self) -> None:
        it = self._current_item()
        if not self._is_folder(it):
            return

        it.setData(0, ROLE_NOTE, self.txt_note.toPlainText() or "")
        self.folderNoteChanged.emit(it.data(0, ROLE_NOTE) or "")
        self.save_to_disk()

    # ---------- public ----------
    def _on_tree_clicked(self, it, _col: int) -> None:
        if it.data(0, ROLE_IS_FOLDER):
            self._open_folder_preview(it)

    def _open_folder_preview(self, folder_it) -> None:
        """
        Open the HtmlPreviewDialog in its native "default document" mode:
          - load persisted edited_html for this node if present
          - else build from the state tree for this node
        This guarantees the same document pipeline as the default editor view.
        """
        title = folder_it.text(0) or "Section preview"

        if self._preview_dlg is None:
            self._preview_dlg = HtmlPreviewDialog(
                parent=self,
                title=title,
                payload_lookup=self._payload_lookup,
            )
        else:
            self._preview_dlg.setWindowTitle(title)

        nid = ""
        self._preview_dlg.set_source(self.collection_name, nid)

        # IMPORTANT: do not inject a generated export document here.
        # Let HtmlPreviewDialog resolve persisted edited_html / build-from-tree by itself.
        self._preview_dlg.set_html("")

        self._preview_dlg.show()
        self._preview_dlg.raise_()
        self._preview_dlg.activateWindow()
        self._preview_dlg.showMaximized()

    def _set_saved_pill(self, saved: bool) -> None:
        if "lbl_save" not in self.__dict__:
            return
        if saved:
            self._last_saved_ts = datetime.now()
            ts = self._last_saved_ts.strftime("%H:%M:%S")
            self.lbl_save.setText(f"Saved {ts}")
            self.lbl_save.setStyleSheet("")
        else:
            self.lbl_save.setText("Saving...")
            self.lbl_save.setStyleSheet(
                "QLabel#CoderSavePill{background: rgba(147,197,253,0.10); border:1px solid rgba(147,197,253,0.22);}"
            )

    def _update_sync_label(self) -> None:
        if "lbl_sync_status" not in self.__dict__:
            return
        if self._last_sync_ts:
            ts = self._last_sync_ts.strftime("%H:%M:%S")
            self.lbl_sync_status.setText(f"Synced {ts}")
        else:
            self.lbl_sync_status.setText("Not synced yet")

    def _append_drop_jsonl(self, payload: dict) -> None:
        from datetime import datetime

        log_path = APP_SESSION_DIR / "coder_drops.jsonl"

        tgt = payload["_coder_target"]
        now = datetime.utcnow().isoformat(timespec="seconds") + "Z"

        row = {
            "ts": now,
            "target": tgt,
            "payload": payload,
        }

        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    def _apply_filter(self) -> None:
        needle = (self.txt_filter.text() or "").strip().lower()
        match_hits = 0
        visible_count = 0

        def _node_matches(it: QTreeWidgetItem) -> bool:
            nonlocal match_hits
            if needle == "":
                match_hits += 1
                return True
            text_val = (it.text(0) or "").lower()
            hit = needle in text_val
            if not hit:
                payload = it.data(0, ROLE_PAYLOAD)
                if isinstance(payload, dict):
                    for k in ("title", "paraphrase", "direct_quote", "text"):
                        v = payload.get(k)
                        if isinstance(v, str) and needle in v.lower():
                            hit = True
                            break
            if hit:
                match_hits += 1
            return hit

        def _walk(it: QTreeWidgetItem) -> bool:
            nonlocal visible_count
            is_folder = bool(it.data(0, ROLE_IS_FOLDER))
            node_matches = _node_matches(it)
            any_child_visible = False
            i = 0
            while i < it.childCount():
                ch = it.child(i)
                i += 1
                vis = _walk(ch)
                any_child_visible = any_child_visible or vis

            vis = node_matches or (is_folder and any_child_visible)
            it.setHidden(not vis)
            if vis:
                visible_count += 1
            if vis and is_folder and needle != "":
                it.setExpanded(True)
            return vis

        root = self.tree.invisibleRootItem()
        i = 0
        while i < root.childCount():
            _walk(root.child(i))
            i += 1

        self._update_filter_status(match_hits, visible_count, needle)

    def _update_filter_status(self, matches: int, shown: int, needle: str) -> None:
        if "lbl_filter_status" not in self.__dict__:
            return
        if needle == "":
            text = f"{shown} entries" if shown else "No entries"
        elif matches == 0:
            text = "No matches"
        else:
            text = f"{matches} matches - {shown} visible"
        self.lbl_filter_status.setText(text)

    # ---------- selection helpers ----------
    def _current_item(self) -> QTreeWidgetItem | None:
        sel = self.tree.selectedItems()
        return sel[0] if sel else None

    def _move_selected_item(self, direction: int) -> None:
        it = self._current_item()
        if not it:
            return
        parent = it.parent() or self.tree.invisibleRootItem()
        idx = parent.indexOfChild(it)
        if idx < 0:
            return
        node = parent.takeChild(idx)
        if node is None:
            return
        target = idx + direction
        limit = parent.childCount()
        if target < 0:
            target = 0
        if target > limit:
            target = limit
        parent.insertChild(target, node)
        self.tree.setCurrentItem(node)
        self.tree.structureChanged.emit()
        self._refresh_move_buttons()

    def _refresh_move_buttons(self) -> None:
        if "btn_move_up" not in self.__dict__ or "btn_move_down" not in self.__dict__:
            return
        it = self._current_item()
        if not it:
            self.btn_move_up.setEnabled(False)
            self.btn_move_down.setEnabled(False)
            return
        parent = it.parent() or self.tree.invisibleRootItem()
        idx = parent.indexOfChild(it)
        if idx < 0:
            self.btn_move_up.setEnabled(False)
            self.btn_move_down.setEnabled(False)
            return
        total = parent.childCount()
        self.btn_move_up.setEnabled(idx > 0)
        self.btn_move_down.setEnabled(idx < total - 1)

    def _is_folder(self, it: QTreeWidgetItem | None) -> bool:
        return bool(it and it.data(0, ROLE_IS_FOLDER))

    # ---------- context menu ----------
    def _open_menu(self, pos):
        it = self._current_item()
        m = QMenu(self)

        if self._is_folder(it):
            m.addAction("View section", lambda: self._open_folder_preview(it))
            m.addSeparator()

            m.addAction("New subfolder", self._new_subfolder)
            m.addAction("Rename", self._rename)
            m.addAction("Delete", self._delete)
            m.addSeparator()

            m.addAction(
                "Export this section (Included only)",
                lambda: self.export_selected_to_html(only_status={STATUS_INCLUDE}),
            )
            m.addAction(
                "Export this section (Included+Maybe)",
                lambda: self.export_selected_to_html(only_status={STATUS_INCLUDE, STATUS_MAYBE}),
            )
            m.addAction(
                "Export this section (All)",
                lambda: self.export_selected_to_html(only_status=None),
            )
        else:
            m.addAction("Mark as Included", lambda: self._set_item_status(it, STATUS_INCLUDE))
            m.addAction("Mark as Maybe", lambda: self._set_item_status(it, STATUS_MAYBE))
            m.addAction("Mark as Excluded", lambda: self._set_item_status(it, STATUS_EXCLUDE))
            m.addSeparator()

            parent = it.parent()
            if parent and self._is_folder(parent):
                m.addAction("View parent section", lambda: self._open_folder_preview(parent))
                m.addSeparator()

            m.addAction("Delete", self._delete)

        m.exec(self.tree.mapToGlobal(pos))

    # ---------- actions ----------
    def _new_subfolder(self):
        self.tree.add_subfolder(self._current_item())

    def _rename(self):
        it = self._current_item()
        if it:
            self.tree.editItem(it, 0)  # delegate handles clear + revert

    def _read_state_blob(self) -> dict:
        import json
        with open(self.state_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _write_state_blob(self, blob: dict) -> None:
        import json
        with open(self.state_path, "w", encoding="utf-8") as f:
            json.dump(blob, f, ensure_ascii=False, indent=2)

    def _default_doc_node(self, blob: dict) -> dict:
        nodes = blob["nodes"]
        return nodes[0]

    def _wrap_full_document(self, body_html: str) -> str:
        css = """
html, body {
  background:#020617;
  color:#e5e7eb;
  margin:24px auto;
  max-width:980px;
  font-family: Inter, system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
h1,h2,h3,h4,h5,h6 { font-weight:650; margin:1.25em 0 .55em 0; line-height:1.25; }
p { line-height:1.65; margin:.70em 0; }
a { color:#93c5fd; text-decoration: underline; }
a:hover { text-decoration: none; }
code { background: rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 6px; }
hr { border:0; border-top:1px solid rgba(148,163,184,0.35); margin:1.35em 0; }
        """.strip()
        safe_body = str(body_html or "")
        return (
            "<!doctype html><html><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>Coder export</title>"
            f"<style>{css}</style>"
            "</head><body>"
            f"{safe_body}"
            "</body></html>"
        )

    def _build_body_from_tree_with_ids(self) -> str:
        import re
        import html as html_module

        def _heading_tag(depth: int) -> str:
            d = int(depth)
            if d < 1:
                d = 1
            if d > 6:
                d = 6
            return "h" + str(d)

        def _strip_qt_to_fragment(src: str) -> str:
            s = (src or "").strip()
            if s == "":
                return ""

            a = s.find("<!--StartFragment-->")
            b = s.find("<!--EndFragment-->")
            if a >= 0 and b > a:
                return s[a + len("<!--StartFragment-->"): b].strip()

            lo = s.lower()
            i0 = lo.find("<body")
            if i0 >= 0:
                j0 = lo.find(">", i0)
                k0 = lo.rfind("</body>")
                if j0 >= 0 and k0 > j0:
                    return s[j0 + 1: k0].strip()

            s2 = re.sub(r"(?is)<!doctype.*?>", "", s).strip()
            s2 = re.sub(r"(?is)<html.*?>", "", s2).strip()
            s2 = re.sub(r"(?is)</html\s*>", "", s2).strip()
            s2 = re.sub(r"(?is)<head.*?>.*?</head\s*>", "", s2).strip()
            s2 = re.sub(r"(?is)<body.*?>", "", s2).strip()
            s2 = re.sub(r"(?is)</body\s*>", "", s2).strip()
            return s2.strip()

        def _emit_note_html(note_text: str) -> str:
            s = (note_text or "").strip()
            if s == "":
                return ""
            lines = s.splitlines()
            buf: list[str] = []
            parts: list[str] = []
            i = 0
            while i < len(lines):
                ln = lines[i]
                if ln.strip() == "":
                    if buf:
                        para = "\n".join(buf).strip()
                        parts.append("<p>" + html_module.escape(para).replace("\n", "<br/>") + "</p>")
                        buf = []
                else:
                    buf.append(ln)
                i += 1
            if buf:
                para = "\n".join(buf).strip()
                parts.append("<p>" + html_module.escape(para).replace("\n", "<br/>") + "</p>")
            return "".join(parts)

        def _payload_fragment(item_it) -> str:
            payload_val = item_it.data(0, ROLE_PAYLOAD) or {}
            a = payload_val.get("section_html") or ""
            if str(a).strip() != "":
                return _strip_qt_to_fragment(str(a))
            b = payload_val.get("html") or ""
            if str(b).strip() != "":
                return _strip_qt_to_fragment(str(b))
            return ""

        def _wrap_item(item_it) -> str:
            iid = str(item_it.data(0, ROLE_NODE_ID) or "").strip()
            frag = _payload_fragment(item_it).strip()
            if frag == "":
                txt = (item_it.text(0) or "").strip()
                if txt != "":
                    frag = "<p>" + html_module.escape(txt) + "</p>"
            return (
                    "<section class='coder-item' data-coder-type='item' data-coder-id='" + html_module.escape(
                iid) + "'>"
                    + frag
                    + "</section>"
            )

        def _wrap_folder(folder_it, depth: int) -> str:
            fid = str(folder_it.data(0, ROLE_NODE_ID) or "").strip()
            name = html_module.escape(folder_it.text(0) or "Section")
            tag = _heading_tag(depth)

            note_text = str(folder_it.data(0, ROLE_NOTE) or "")
            note_html = _emit_note_html(note_text)

            kids_parts: list[str] = []
            i = 0
            while i < folder_it.childCount():
                ch = folder_it.child(i)
                i += 1
                if bool(ch.data(0, ROLE_IS_FOLDER)):
                    kids_parts.append(_wrap_folder(ch, depth + 1))
                else:
                    kids_parts.append(_wrap_item(ch))

            return (
                    "<section class='coder-folder' data-coder-type='folder' data-coder-id='" + html_module.escape(
                fid) + "'>"
                       "<" + tag + " class='coder-title'>" + name + "</" + tag + ">"
                                                                                 "<div class='coder-note' data-coder-type='note' data-coder-id='note:" + html_module.escape(
                fid) + "'>" + note_html + "</div>"
                                          "<div class='coder-children'>" + "".join(kids_parts) + "</div>"
                                                                                                 "</section>"
            )

        root = self.tree.invisibleRootItem()
        if root.childCount() == 0:
            return ""

        top = root.child(0)
        if not bool(top.data(0, ROLE_IS_FOLDER)):
            raise RuntimeError("top-level tree root must be a folder for canonical HTML build")

        return _wrap_folder(top, 1)

    def _build_folder_section_html(self, folder_it: QTreeWidgetItem, depth: int) -> str:
        """
        Build HTML that is compatible with HtmlPreviewDialog._sync_state_tree_from_body_html:

          folder wrapper:
            <section class='coder-folder' data-coder-id='{fid}' data-coder-type='folder'>
              <hN class='coder-title'>...</hN>
              <div class='coder-note' data-coder-id='note:{fid}' data-coder-type='note'>...</div>
              <div class='coder-children'> ... </div>
            </section>

          item wrapper:
            <section class='coder-item' data-coder-id='{iid}' data-coder-type='item'> ...payload html... </section>
        """
        import html as html_module
        import re

        def _heading_tag(d: int) -> str:
            x = int(d)
            if x < 1:
                x = 1
            if x > 6:
                x = 6
            return "h" + str(x)

        def _strip_qt_to_fragment(src: str) -> str:
            s = (src or "").strip()
            if s == "":
                return ""

            a = s.find("<!--StartFragment-->")
            b = s.find("<!--EndFragment-->")
            if a >= 0 and b > a:
                return s[a + len("<!--StartFragment-->"): b].strip()

            lo = s.lower()
            i0 = lo.find("<body")
            if i0 >= 0:
                j0 = lo.find(">", i0)
                k0 = lo.rfind("</body>")
                if j0 >= 0 and k0 > j0:
                    return s[j0 + 1: k0].strip()

            s2 = re.sub(r"(?is)<!doctype.*?>", "", s).strip()
            s2 = re.sub(r"(?is)<html.*?>", "", s2).strip()
            s2 = re.sub(r"(?is)</html\s*>", "", s2).strip()
            s2 = re.sub(r"(?is)<head.*?>.*?</head\s*>", "", s2).strip()
            s2 = re.sub(r"(?is)<body.*?>", "", s2).strip()
            s2 = re.sub(r"(?is)</body\s*>", "", s2).strip()
            return s2.strip()

        def _emit_note_html(note_text: str) -> str:
            s = (note_text or "").strip()
            if s == "":
                return ""
            lines = s.splitlines()
            buf: list[str] = []
            parts: list[str] = []
            i = 0
            while i < len(lines):
                ln = lines[i]
                if ln.strip() == "":
                    if buf:
                        para = "\n".join(buf).strip()
                        parts.append("<p>" + html_module.escape(para).replace("\n", "<br/>") + "</p>")
                        buf = []
                else:
                    buf.append(ln)
                i += 1
            if buf:
                para = "\n".join(buf).strip()
                parts.append("<p>" + html_module.escape(para).replace("\n", "<br/>") + "</p>")
            return "".join(parts)

        def _payload_html(it: QTreeWidgetItem) -> str:
            payload_val = it.data(0, ROLE_PAYLOAD) or {}
            a = payload_val.get("section_html") or ""
            if str(a).strip() != "":
                return _strip_qt_to_fragment(str(a))
            b = payload_val.get("html") or ""
            if str(b).strip() != "":
                return _strip_qt_to_fragment(str(b))
            title_txt = (it.text(0) or "").strip()
            if title_txt != "":
                return "<p>" + html_module.escape(title_txt) + "</p>"
            return "<p><br></p>"

        fid = str(folder_it.data(0, ROLE_NODE_ID) or "")
        if fid == "":
            fid = self.tree.ensure_node_id(folder_it)

        title = html_module.escape(folder_it.text(0) or "Section")
        tag = _heading_tag(depth)

        note_text = str(folder_it.data(0, ROLE_NOTE) or "")
        note_html = _emit_note_html(note_text)

        child_parts: list[str] = []
        i = 0
        while i < folder_it.childCount():
            ch = folder_it.child(i)
            i += 1
            if bool(ch.data(0, ROLE_IS_FOLDER)):
                child_parts.append(self._build_folder_section_html(ch, depth + 1))
                continue

            iid = str(ch.data(0, ROLE_NODE_ID) or "")
            if iid == "":
                iid = self.tree.ensure_node_id(ch)

            frag = _payload_html(ch)
            child_parts.append(
                "<section class='coder-item' data-coder-id='" + iid + "' data-coder-type='item'>"
                + str(frag or "")
                + "</section>"
            )

        return (
                "<section class='coder-folder' data-coder-id='" + fid + "' data-coder-type='folder'>"
                                                                        "<" + tag + " class='coder-title'>" + title + "</" + tag + ">"
                                                                                                                                   "<div class='coder-note' data-coder-id='note:" + fid + "' data-coder-type='note'>" + note_html + "</div>"
                                                                                                                                                                                                                                    "<div class='coder-children'>" + "".join(
            child_parts) + "</div>"
                           "</section>"
        )

    def _sync_all_folder_docs_from_tree(self) -> None:
        """
        Persist edited_html for EVERY folder node (top-level + all subfolders),
        so HtmlPreviewDialog can open any folder and see a document that matches the tree.

        Policy:
          - For each folder: overwrite edited_html with canonical HTML built from current tree.
          - For items: leave edited_html as-is (not used).
        """
        from datetime import datetime, timezone

        def _walk_and_apply(folder_it: QTreeWidgetItem, blob: dict) -> None:
            fid = str(folder_it.data(0, ROLE_NODE_ID) or "")
            if fid == "":
                fid = self.tree.ensure_node_id(folder_it)

            section_html = self._build_folder_section_html(folder_it, 1)
            full_doc = self._wrap_full_document(section_html)

            # find node in blob and overwrite edited_html
            def _find_node_by_id(node: dict, wanted_id: str) -> dict:
                if str(node.get("id") or "") == wanted_id:
                    return node
                kids = node.get("children") or []
                j = 0
                while j < len(kids):
                    hit = _find_node_by_id(kids[j], wanted_id)
                    if str(hit.get("id") or "") == wanted_id:
                        return hit
                    j += 1
                return {}

            nodes = blob["nodes"]
            k = 0
            while k < len(nodes):
                hit = _find_node_by_id(nodes[k], fid)
                if str(hit.get("id") or "") == fid:
                    hit["edited_html"] = full_doc
                    hit["updated_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
                    break
                k += 1

            # recurse children folders
            i = 0
            while i < folder_it.childCount():
                ch = folder_it.child(i)
                i += 1
                if bool(ch.data(0, ROLE_IS_FOLDER)):
                    _walk_and_apply(ch, blob)

        blob = self._read_state_blob()

        # Ensure the JSON tree order matches the widget order first.
        # This is already what save_to_disk() does, but we assume caller ran it.
        root = self.tree.invisibleRootItem()
        i = 0
        while i < root.childCount():
            top = root.child(i)
            if bool(top.data(0, ROLE_IS_FOLDER)):
                _walk_and_apply(top, blob)
            i += 1

        self._write_state_blob(blob)
        self._last_sync_ts = datetime.now()
        self._update_sync_label()

    def _sync_default_doc_rebuild_if_empty(self) -> None:
        """
        Backwards-compatible entrypoint: we now sync all folder documents, always.
        """
        self._sync_all_folder_docs_from_tree()

    def _sync_default_doc_after_drop(self, payload: dict) -> None:
        from bs4 import BeautifulSoup

        blob = self._read_state_blob()
        doc = self._default_doc_node(blob)

        full = str(doc.get("edited_html") or "")
        if full.strip() == "":
            body_new = self._build_body_from_tree_with_ids()
            doc["edited_html"] = self._wrap_full_document(
                body_new if str(body_new or "").strip() != "" else "<p><br></p>")
            self._write_state_blob(blob)
            return

        soup = BeautifulSoup(full, "html.parser")
        body = soup.find("body")

        item_id = str(payload.get("_coder_item_id") or payload.get("coder_id") or "").strip()
        folder_id = str(
            (payload.get("_coder_target") or {}).get("node_id") or payload.get("coder_parent_id") or "").strip()

        if item_id == "":
            raise RuntimeError("drop payload missing item id")

        item_section = soup.new_tag("section")
        item_section["class"] = "coder-item"
        item_section["data-coder-type"] = "item"
        item_section["data-coder-id"] = item_id
        item_section.append(BeautifulSoup(str(payload.get("html") or ""), "html.parser"))

        if folder_id == "":
            root_folder = body.find(attrs={"data-coder-type": "folder"})
            if root_folder is None:
                body_new = self._build_body_from_tree_with_ids()
                doc["edited_html"] = self._wrap_full_document(
                    body_new if str(body_new or "").strip() != "" else "<p><br></p>")
                self._write_state_blob(blob)
                return

            children = root_folder.find(class_="coder-children")
            if children is None:
                body_new = self._build_body_from_tree_with_ids()
                doc["edited_html"] = self._wrap_full_document(
                    body_new if str(body_new or "").strip() != "" else "<p><br></p>")
                self._write_state_blob(blob)
                return

            children.append(item_section)
            doc["edited_html"] = str(soup)
            self._write_state_blob(blob)
            return

        folder_section = body.find(attrs={"data-coder-type": "folder", "data-coder-id": folder_id})
        if folder_section is None:
            body_new = self._build_body_from_tree_with_ids()
            doc["edited_html"] = self._wrap_full_document(
                body_new if str(body_new or "").strip() != "" else "<p><br></p>")
            self._write_state_blob(blob)
            return

        kids = folder_section.find(class_="coder-children")
        if kids is None:
            body_new = self._build_body_from_tree_with_ids()
            doc["edited_html"] = self._wrap_full_document(
                body_new if str(body_new or "").strip() != "" else "<p><br></p>")
            self._write_state_blob(blob)
            return

        kids.append(item_section)

        doc["edited_html"] = str(soup)
        self._write_state_blob(blob)

    def _sync_default_doc_remove_by_id(self, node_id: str) -> None:
        from bs4 import BeautifulSoup

        blob = self._read_state_blob()
        doc = self._default_doc_node(blob)

        full = str(doc.get("edited_html") or "")
        if full.strip() == "":
            return

        nid = str(node_id or "").strip()
        if nid == "":
            raise RuntimeError("remove_by_id called with blank node_id")

        soup = BeautifulSoup(full, "html.parser")
        body = soup.find("body")

        el = body.find(attrs={"data-coder-id": nid, "data-coder-type": "item"})
        if el is None:
            el = body.find(attrs={"data-coder-id": nid, "data-coder-type": "folder"})
        if el is None:
            return

        el.decompose()
        doc["edited_html"] = str(soup)
        self._write_state_blob(blob)

    def _sync_default_doc_update_folder_title(self, folder_id: str, new_title: str) -> None:
        from bs4 import BeautifulSoup

        blob = self._read_state_blob()
        doc = self._default_doc_node(blob)

        full = str(doc.get("edited_html") or "")
        if full.strip() == "":
            return

        fid = str(folder_id or "").strip()
        if fid == "":
            raise RuntimeError("update_folder_title called with blank folder_id")

        soup = BeautifulSoup(full, "html.parser")
        body = soup.find("body")

        folder_section = body.find(attrs={"data-coder-type": "folder", "data-coder-id": fid})
        if folder_section is None:
            return

        title_el = folder_section.find(class_="coder-title")
        if title_el is None:
            return

        title_el.clear()
        title_el.append(str(new_title or ""))

        doc["edited_html"] = str(soup)
        self._write_state_blob(blob)

    def _delete(self):
        it = self._current_item()
        if not it:
            return
        node_id = str(it.data(0, ROLE_NODE_ID) or "")
        parent = it.parent() or self.tree.invisibleRootItem()
        parent.removeChild(it)
        self.save_to_disk()
        self._sync_default_doc_remove_by_id(node_id)

    def _set_item_status(self, it: QTreeWidgetItem | None, status: str) -> None:
        """
        ###1. Validate target is a payload item
        ###2. Apply status + update visible title chrome
        ###3. Persist
        """
        allowed = {STATUS_INCLUDE, STATUS_MAYBE, STATUS_EXCLUDE}
        if it is None:
            return
        if self._is_folder(it):
            return
        if status not in allowed:
            return

        it.setData(0, ROLE_STATUS, status)

        raw_title = it.data(0, Qt.ItemDataRole.UserRole + 900) or ""
        if not isinstance(raw_title, str) or raw_title.strip() == "":
            raw_title = it.text(0) or ""
            it.setData(0, Qt.ItemDataRole.UserRole + 900, raw_title)

        badge = "I" if status == STATUS_INCLUDE else ("?" if status == STATUS_MAYBE else "×")
        it.setText(0, f"[{badge}] {raw_title}")

        fg = QColor("#e5e7eb")
        if status == STATUS_INCLUDE:
            fg = QColor("#bbf7d0")
        if status == STATUS_MAYBE:
            fg = QColor("#fde68a")
        if status == STATUS_EXCLUDE:
            fg = QColor("#fecaca")

        it.setData(0, Qt.ItemDataRole.ForegroundRole, fg)

        self.save_to_disk()
        self._set_saved_pill(True)

    def eventFilter(self, obj, ev):
        if obj is self.tree and ev.type() == QEvent.Type.KeyPress:
            it = self._current_item()
            if it and not self._is_folder(it):
                if ev.key() == Qt.Key.Key_1:
                    self._set_item_status(it, STATUS_INCLUDE);
                    return True
                if ev.key() == Qt.Key.Key_2:
                    self._set_item_status(it, STATUS_MAYBE);
                    return True
                if ev.key() == Qt.Key.Key_3:
                    self._set_item_status(it, STATUS_EXCLUDE);
                    return True
        return super().eventFilter(obj, ev)

    # ---------- selection/notes/preview ----------
    def _on_select(self):
        it = self._current_item()
        self._refresh_note_panel()
        self._refresh_move_buttons()
        if it and not self._is_folder(it):
            payload = it.data(0, ROLE_PAYLOAD) or {}
            if payload:
                self.payloadSelected.emit(payload)





    # ---------- persistence (unchanged from your version) ----------
    def _export_item(self, it: QTreeWidgetItem) -> dict:
        if self._is_folder(it):
            return {
                "type": "folder",
                "id": it.data(0, ROLE_NODE_ID) or "",
                "name": it.text(0),
                "note": it.data(0, ROLE_NOTE) or "",
                "edited_html": it.data(0, ROLE_EDITED_HTML) or "",
                "children": [self._export_item(it.child(i)) for i in range(it.childCount())],
            }

        else:
            return {
                "type": "item",
                "id": it.data(0, ROLE_NODE_ID) or "",
                "title": it.text(0),
                "status": it.data(0, ROLE_STATUS) or STATUS_INCLUDE,
                "payload": it.data(0, ROLE_PAYLOAD) or {},
            }

    def _import_item(self, d: Dict, parent: Optional[QTreeWidgetItem]) -> None:
        t = (d or {}).get("type")
        if t == "folder":
            it = self.tree.add_folder(d.get("name") or "Section", parent)
            it.setData(0, ROLE_NODE_ID, d.get("id") or str(uuid4()))
            it.setData(0, ROLE_NOTE, d.get("note") or "")
            it.setData(0, ROLE_EDITED_HTML, d.get("edited_html") or "")

            for ch in (d.get("children") or []):
                self._import_item(ch, it)
        elif t == "item":
            it = self.tree.add_payload_node(d.get("payload") or {}, parent)
            it.setData(0, ROLE_NODE_ID, d.get("id") or str(uuid4()))
            it.setData(0, ROLE_NOTE, d.get("note") or "")
            it.setData(0, ROLE_EDITED_HTML, d.get("edited_html") or "")

    def save_to_disk(self) -> bool:
        try:
            self.base_dir.mkdir(parents=True, exist_ok=True)
            root_list = []
            root = self.tree.invisibleRootItem()
            for i in range(root.childCount()):
                root_list.append(self._export_item(root.child(i)))
            with open(self.state_path, "w", encoding="utf-8") as f:
                json.dump({"version": 2, "nodes": root_list}, f, ensure_ascii=False, indent=2)
            return True
        except Exception:
            return False

    def load_from_disk(self) -> bool:
        try:
            if not self.state_path.exists():
                return False
            with open(self.state_path, "r", encoding="utf-8") as f:
                blob = json.load(f) or {}
            nodes = blob.get("nodes") or []
            self.tree.clear()
            for nd in nodes:
                self._import_item(nd, None)
            return True
        except Exception:
            return False

    # ---------- export HTML (same as before, or your path-prompting version) ----------
    # ---------- export HTML ----------
    def export_selected_to_html(self, only_status: set[str] | None):
        it = self._current_item()
        if not it:
            return

        root = it if self._is_folder(it) else (it.parent() or it)
        title = root.text(0) or "Section"
        html_str = self._build_section_html(root, only_status=only_status)

        from PyQt6.QtWidgets import QFileDialog, QMessageBox
        from pathlib import Path

        suggested = f"{_sanitize_filename(title)}.html"
        start_dir = str(self.base_dir) if self.base_dir else str(Path.home())

        path, _ = QFileDialog.getSaveFileName(
            self,
            "Save HTML",
            str(Path(start_dir) / suggested),
            "HTML files (*.html);;All files (*.*)",
        )
        if not path:
            return

        self._set_saved_pill(False)
        with open(path, "w", encoding="utf-8") as f:
            f.write(html_str)
        self._set_saved_pill(True)

        QMessageBox.information(self, "Export complete", f"Saved to:\n{path}")

    def copy_selected_to_html(self, only_status: set[str] | None) -> None:
        it = self._current_item()
        if not it:
            return
        root = it if self._is_folder(it) else (it.parent() or it)
        html_str = self._build_section_html(root, only_status=only_status)

        cb = QApplication.clipboard()
        cb.setText(html_str or "")
        self._set_saved_pill(True)

    def preview_selected_html(self, only_status: set[str] | None) -> None:
        import re
        from PyQt6.QtCore import QEvent
        from PyQt6.QtGui import QCursor, QTextCursor
        from PyQt6.QtWidgets import (
            QApplication,
            QDialog,
            QHBoxLayout,
            QPushButton,
            QTextBrowser,
            QToolTip,
            QVBoxLayout,
        )

        it = self._current_item()
        if not it:
            return

        root = it if self._is_folder(it) else (it.parent() or it)
        html_str = self._build_section_html(root, only_status=only_status)

        class _PreviewDialog(QDialog):
            def __init__(self, parent=None) -> None:
                super().__init__(parent)
                self.setWindowTitle("Export preview")
                self.resize(980, 720)

                self._last_hover_href = ""
                self._href_to_title = {}

                v = QVBoxLayout(self)
                v.setContentsMargins(10, 10, 10, 10)
                v.setSpacing(8)

                self.browser = QTextBrowser(self)
                self.browser.setOpenExternalLinks(True)
                self.browser.setOpenLinks(True)
                self.browser.setReadOnly(True)

                self.browser.setMouseTracking(True)
                self.browser.viewport().setMouseTracking(True)
                self.browser.viewport().installEventFilter(self)

                v.addWidget(self.browser, 1)

                row = QHBoxLayout()
                row.addStretch(1)

                self.btn_copy = QPushButton("Copy HTML", self)
                self.btn_close = QPushButton("Close", self)
                row.addWidget(self.btn_copy, 0)
                row.addWidget(self.btn_close, 0)
                v.addLayout(row, 0)

                self.btn_close.clicked.connect(self.accept)

            def set_html(self, html: str) -> None:
                src = html or ""
                self._href_to_title = {}

                for m in re.finditer(r'(?is)<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))[^>]*>', src):
                    tag = m.group(0)
                    href = (m.group(1) or m.group(2) or m.group(3) or "").strip()
                    mt = re.search(r'(?is)\btitle\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))', tag)
                    title = ((mt.group(1) or mt.group(2) or mt.group(3)) if mt else "").strip()
                    if href:
                        self._href_to_title[href] = title

                self.browser.setHtml(src)

            def eventFilter(self, obj, ev):
                if obj is self.browser.viewport() and ev.type() == QEvent.Type.MouseMove:
                    pos = ev.position().toPoint()

                    c0 = self.browser.cursorForPosition(pos)
                    href = c0.charFormat().anchorHref() or ""

                    if href == "":
                        if self._last_hover_href != "":
                            self._last_hover_href = ""
                            QToolTip.hideText()
                        return False

                    c_start = QTextCursor(c0)
                    while c_start.movePosition(QTextCursor.MoveOperation.PreviousCharacter):
                        if c_start.charFormat().anchorHref() != href:
                            c_start.movePosition(QTextCursor.MoveOperation.NextCharacter)
                            break

                    c_end = QTextCursor(c0)
                    while c_end.movePosition(QTextCursor.MoveOperation.NextCharacter):
                        if c_end.charFormat().anchorHref() != href:
                            break

                    c_sel = QTextCursor(self.browser.document())
                    c_sel.setPosition(c_start.position())
                    c_sel.setPosition(c_end.position(), QTextCursor.MoveMode.KeepAnchor)

                    anchor_text = (c_sel.selectedText() or "").strip()
                    title = (self._href_to_title.get(href) or "").strip()

                    tip = title or anchor_text or href

                    if href != self._last_hover_href:
                        self._last_hover_href = href
                        QToolTip.showText(QCursor.pos(), tip, self.browser)

                    return False

                if obj is self.browser.viewport() and ev.type() == QEvent.Type.Leave:
                    self._last_hover_href = ""
                    QToolTip.hideText()
                    return False

                return super().eventFilter(obj, ev)

        dlg = _PreviewDialog(self)
        dlg.set_html(html_str or "")
        dlg.btn_copy.clicked.connect(lambda: QApplication.clipboard().setText(html_str or ""))
        dlg.exec()

    def _build_section_html(self, root, only_status: set[str] | None) -> str:
        """
        Goal: when exporting a folder (only_status=None), return the exact same document
        as the HtmlPreviewDialog "default document" for that node:

          - If the folder has persisted edited_html and only_status is None, return it as-is.
          - Otherwise, generate HTML from the tree using the SAME export CSS as HtmlPreviewDialog.
        """
        from datetime import datetime
        import html as html_module
        import re
        import json

        export_css = """
    html, body {
      background:#020617;
      color:#e5e7eb;
      margin:24px auto;
      max-width:980px;
      font-family: Inter, system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    h1,h2,h3,h4,h5,h6 { font-weight:650; margin:1.25em 0 .55em 0; line-height:1.25; }
    p { line-height:1.65; margin:.70em 0; }
    a { color:#93c5fd; text-decoration: underline; }
    a:hover { text-decoration: none; }
    code { background: rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 6px; }
    hr { border:0; border-top:1px solid rgba(148,163,184,0.35); margin:1.35em 0; }
    .meta { color:#9ca3af; font-size:13px; }
        """.strip()

        def _heading_tag(depth: int) -> str:
            d = int(depth)
            if d < 1:
                d = 1
            if d > 6:
                d = 6
            return "h" + str(d)

        def _strip_qt_to_fragment(src: str) -> str:
            s = (src or "").strip()
            if s == "":
                return ""

            a = s.find("<!--StartFragment-->")
            b = s.find("<!--EndFragment-->")
            if a >= 0 and b > a:
                return s[a + len("<!--StartFragment-->"): b].strip()

            lo = s.lower()
            i = lo.find("<body")
            if i >= 0:
                j = lo.find(">", i)
                k = lo.rfind("</body>")
                if j >= 0 and k > j:
                    return s[j + 1: k].strip()

            s2 = re.sub(r"(?is)<!doctype.*?>", "", s).strip()
            s2 = re.sub(r"(?is)<html.*?>", "", s2).strip()
            s2 = re.sub(r"(?is)</html\s*>", "", s2).strip()
            s2 = re.sub(r"(?is)<head.*?>.*?</head\s*>", "", s2).strip()
            s2 = re.sub(r"(?is)<body.*?>", "", s2).strip()
            s2 = re.sub(r"(?is)</body\s*>", "", s2).strip()
            return s2.strip()

        def _payload_html(it) -> str:
            payload_val = it.data(0, ROLE_PAYLOAD)
            if not payload_val:
                return ""

            frag = payload_val["section_html"]
            if str(frag).strip() != "":
                return _strip_qt_to_fragment(str(frag))

            frag2 = payload_val["html"]
            if str(frag2).strip() != "":
                return _strip_qt_to_fragment(str(frag2))

            return ""

        def _emit_note(parts: list[str], note: str) -> None:
            s = (note or "").strip()
            if s == "":
                return
            lines = s.splitlines()
            buf: list[str] = []
            i = 0
            while i < len(lines):
                ln = lines[i]
                if ln.strip() == "":
                    if buf:
                        para = "\n".join(buf).strip()
                        parts.append("<p>" + html_module.escape(para).replace("\n", "<br/>") + "</p>")
                        buf = []
                else:
                    buf.append(ln)
                i += 1
            if buf:
                para = "\n".join(buf).strip()
                parts.append("<p>" + html_module.escape(para).replace("\n", "<br/>") + "</p>")

        def _emit_folder(parts: list[str], folder_it, depth: int) -> None:
            tag = _heading_tag(depth)
            title = html_module.escape(folder_it.text(0) or "Section")
            parts.append("<" + tag + ">" + title + "</" + tag + ">")

            note = folder_it.data(0, ROLE_NOTE) or ""
            _emit_note(parts, str(note or ""))

            i = 0
            while i < folder_it.childCount():
                ch = folder_it.child(i)
                i += 1

                if bool(ch.data(0, ROLE_IS_FOLDER)):
                    _emit_folder(parts, ch, depth + 1)
                    continue

                status_text = str(ch.data(0, ROLE_STATUS) or "")
                if only_status and status_text not in only_status:
                    continue

                frag = _payload_html(ch)
                if frag.strip() != "":
                    parts.append(frag)
                else:
                    txt = (ch.text(0) or "").strip()
                    if txt != "":
                        parts.append("<p>" + html_module.escape(txt) + "</p>")

        def _find_node_by_id(node: dict, wanted_id: str) -> dict:
            if (node["id"] or "") == wanted_id:
                return node
            kids = node["children"] or []
            i = 0
            while i < len(kids):
                hit = _find_node_by_id(kids[i], wanted_id)
                if (hit.get("id") or "") == wanted_id:
                    return hit
                i += 1
            return {}

        # If exporting a folder: prefer returning its persisted edited_html exactly (default doc).
        if bool(root.data(0, ROLE_IS_FOLDER)):
            nid = str(root.data(0, ROLE_NODE_ID) or "").strip()
            if nid != "":
                with open(self.state_path, "r", encoding="utf-8") as f:
                    blob = json.load(f) or {}
                nodes = blob["nodes"]

                i = 0
                while i < len(nodes):
                    hit = _find_node_by_id(nodes[i], nid)
                    if (hit.get("id") or "") == nid:
                        edited = str(hit.get("edited_html") or "")
                        if only_status is None and edited.strip() != "":
                            return edited
                        break
                    i += 1

        parts: list[str] = []
        parts.append("<!doctype html>")
        parts.append("<html>")
        parts.append("<head>")
        parts.append("<meta charset='utf-8'>")
        parts.append("<meta name='viewport' content='width=device-width,initial-scale=1'>")
        parts.append("<title>Coder export</title>")
        parts.append("<style>" + export_css + "</style>")
        parts.append("</head>")
        parts.append("<body>")

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
        parts.append("<p class='meta'>Exported on " + html_module.escape(now_str) + "</p>")

        if bool(root.data(0, ROLE_IS_FOLDER)):
            _emit_folder(parts, root, 1)
        else:
            parent = root.parent() or self.tree.invisibleRootItem()
            _emit_folder(parts, parent, 1)

        parts.append("</body>")
        parts.append("</html>")
        return "\n".join(parts)
