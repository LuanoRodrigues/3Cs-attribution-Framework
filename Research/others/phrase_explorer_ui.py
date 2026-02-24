# academic_suite/ui/phrase_explorer_ui.py (PYQt6 VERSION)

import html as _html_module
import re
from pathlib import Path
from collections import defaultdict, Counter
from typing import List, Dict, Any

from bs4 import BeautifulSoup, NavigableString # Keep this
from PyQt6.QtWidgets import ( # CHANGED
    QWidget, QListWidget, QListWidgetItem,
    QTextBrowser, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QSplitter,
    QLineEdit, QMessageBox, QFrame
)
from PyQt6.QtCore import Qt, QUrl, pyqtSignal
from PyQt6.QtGui import  QTextCursor, QDesktopServices

PHRASE_EXPLORER_CSS = """
<style> /* Your existing CSS is largely compatible */
body { background: #202124; color: #e3e3e3; font-family: 'Inter', sans-serif; font-size: 14px; margin:0; } /* Adjusted font-size */
.page-content { background: #2b2b2e; width: 95%; max-width: 780px; margin: 15px auto; padding: 15px 25px; border-radius: 6px; line-height: 1.55; }
h1 { font-size: 18px; color: #dcdcdc; border-bottom: 1px solid #4a4a4e; padding-bottom: 8px; margin-bottom:12px;}
h2 { font-size: 16px; color: #c4c4c4; border-bottom: 1px solid #404043; padding-bottom: 6px; margin: 18px 0 8px;}
p { margin: 0 0 10px; text-align: justify; }
mark { background: #ffe564; color: #000; padding: 1px 3px; border-radius: 3px; }
a { color: #8ab4f8; text-decoration: none; } a:hover { text-decoration: underline; }
sup { vertical-align: super; font-size: 0.75em; line-height: 1; } sup a { color: #8ab4f8; }
ol.ref-list { padding-left: 18px; margin: 6px 0; } ol.ref-list li { margin: 0 0 6px 0; }
.ref-page-content { padding: 12px; line-height: 1.45; }
.ref-page-content h2 { font-size: 15px; color: #c4c4c4; margin-bottom:8px; border-bottom:1px solid #4a4a4e; padding-bottom:5px;}
#InputFrame { border: 1px solid #404043; border-radius: 5px; padding: 8px; margin-bottom:8px; }
#InputFrame QLineEdit { background-color: #38393d; color: #e0e0e0; border: 1px solid #505155; border-radius: 3px; padding: 5px; font-size: 13px; }
#InputFrame QPushButton { background-color: #007ACC; color: white; padding: 7px 12px; border-radius: 4px; font-size: 13px; }
#InputFrame QPushButton:hover { background-color: #005C99; }
</style>
"""

class PhraseExplorerWidget(QWidget):
    loadDataRequested = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("PhraseExplorerWidget")
        self.matches_data = []
        self.by_doc: Dict[str, Dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
        self.meta: Dict[str, Dict[str, str]] = defaultdict(dict)
        self.docs_list = []
        self.current_doc_idx = 0
        self.current_mode = "doc"
        self._setup_ui()

    def _setup_ui(self):
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(5, 5, 5, 5); main_layout.setSpacing(5)

        input_frame = QFrame(); input_frame.setObjectName("InputFrame")
        input_layout = QHBoxLayout(input_frame)
        self.collection_name_label = QLabel("Zotero Collection:")
        self.collection_name_edit = QLineEdit()
        self.collection_name_edit.setPlaceholderText("Enter collection name")
        self.load_data_button = QPushButton("🔍 Load Phrases")
        self.load_data_button.clicked.connect(self._request_load_data)
        input_layout.addWidget(self.collection_name_label)
        input_layout.addWidget(self.collection_name_edit, 1)
        input_layout.addWidget(self.load_data_button)
        main_layout.addWidget(input_frame)

        self.class_list_widget = QListWidget()
        self.class_list_widget.setStyleSheet(
            "QListWidget { background-color: #2b2b2e; color: #d0d0d0; border: 1px solid #3c3c3c; font-size: 13px; padding: 4px; }"
            "QListWidget::item { padding: 4px; }"
            "QListWidget::item:selected { background-color: #007ACC; color: white; }"
        )
        self.class_list_widget.itemClicked.connect(self._render_center_right_panes)

        self.text_view_browser = QTextBrowser()
        self.text_view_browser.setOpenExternalLinks(False)
        self.text_view_browser.anchorClicked.connect(self._handle_text_view_anchor_click)
        self.text_view_browser.setStyleSheet("background-color: #202124; border: none;")

        self.ref_view_browser = QTextBrowser()
        self.ref_view_browser.setStyleSheet("QTextBrowser { background-color: #202124; border-left: 1px solid #3c3c3c; padding: 0px; }")
        self.ref_view_browser.setOpenExternalLinks(True)

        content_splitter = QSplitter(Qt.Orientation.Horizontal) # CHANGED Orientation
        content_splitter.addWidget(self.class_list_widget)
        content_splitter.addWidget(self.text_view_browser)
        content_splitter.addWidget(self.ref_view_browser)
        content_splitter.setStretchFactor(0, 2); content_splitter.setStretchFactor(1, 5); content_splitter.setStretchFactor(2, 2) # Adjusted ratios
        content_splitter.setSizes([200, 600, 250])

        nav_bar = self._make_nav_bar_widget()
        main_layout.addWidget(nav_bar)
        main_layout.addWidget(content_splitter, 1)
        self.setLayout(main_layout)
        self._show_placeholder_content()

    def set_default_collection(self, collection_name: str):
        self.collection_name_edit.setText(collection_name)

    def _request_load_data(self):
        collection_name = self.collection_name_edit.text().strip()
        if not collection_name:
            QMessageBox.warning(self, "Input Required", "Please enter a Zotero collection name.")
            return
        self.loadDataRequested.emit(collection_name)
        self.load_data_button.setText("🔄 Reloading..."); self.load_data_button.setEnabled(False)

    def load_data(self, matches_data: List[Dict[str, Any]] | None):
        self.load_data_button.setText("🔍 Load Phrases"); self.load_data_button.setEnabled(True)
        if matches_data is None:
            self._show_placeholder_content("No phrase matches found or error during loading.")
            return
        self.matches_data = matches_data
        self._prepare_data_structures()
        self.docs_list = list(self.by_doc.keys())
        if self.docs_list: self.docs_list.sort()
        self.current_doc_idx = 0
        self._refresh_left_pane()
        self._render_center_right_panes()
        if not self.docs_list: self._show_placeholder_content("No documents with matching phrases found.")

    def _show_placeholder_content(self, message="Enter collection & click 'Load Phrases'."):
        self.class_list_widget.clear()
        self.text_view_browser.setHtml(f"<html><head>{PHRASE_EXPLORER_CSS}</head><body><div class='page-content'><p>{message}</p></div></body></html>")
        self.ref_view_browser.setHtml(f"<html><head>{PHRASE_EXPLORER_CSS}</head><body><div class='ref-page-content'><h2>References</h2></div></body></html>")
        if hasattr(self, 'doc_counter_label'): self.doc_counter_label.setText("Doc 0/0")
        if hasattr(self, 'mode_button'): self.mode_button.setEnabled(False)
        if hasattr(self, 'prev_doc_button'):self.prev_doc_button.setEnabled(False)
        if hasattr(self, 'next_doc_button'):self.next_doc_button.setEnabled(False)


    def _prepare_data_structures(self):
        self.by_doc.clear(); self.meta.clear(); self.docs_list = []
        if not self.matches_data: return
        def plain(t): return BeautifulSoup(t,"html.parser").get_text(" ",strip=True)
        def mc(t): return t.count("<mark>")
        seen:Dict[tuple,str]={};
        for m in self.matches_data:
            d,c,p=m["doc_label"],m["class"],m["paragraph"];k=(d,c,plain(p))
            if k in seen:
                if mc(p)>mc(seen[k]):seen[k]=p
            else:seen[k]=p
            if d not in self.meta:self.meta[d]={"authors":m.get("authors"),"year":m.get("year"),"title":m.get("title")}
        for (d,c,_),hp in seen.items(): self.by_doc[d][c].append(hp)
        for dk in list(self.by_doc.keys()):
            if dk not in self.meta: self.meta[dk]={"authors":Path(dk).stem,"year":"n.d.","title":Path(dk).stem}

    def _make_nav_bar_widget(self) -> QWidget:
        self.mode_button = QPushButton("📄 Doc", checkable=True) # Shorter text
        self.mode_button.clicked.connect(self._toggle_view_mode)
        self.prev_doc_button = QPushButton("◀"); self.next_doc_button = QPushButton("▶") # Icons
        # Shortcuts might be better managed at MainWindow level if tabs can lose focus for shortcuts
        # self.prev_doc_button.setShortcut(QKeySequence("Alt+Left"))
        # self.next_doc_button.setShortcut(QKeySequence("Alt+Right"))
        self.prev_doc_button.clicked.connect(lambda: self._switch_document(-1))
        self.next_doc_button.clicked.connect(lambda: self._switch_document(+1))
        self.doc_counter_label = QLabel("Doc 0/0")
        self.doc_counter_label.setStyleSheet("color:#b0b0b0; font-size:12px; padding-right: 3px;")
        btn_style = ("QPushButton { background-color:#3a3b3e; color:#d0d0d0; border:1px solid #4a4b4e; padding:5px 8px; border-radius:3px; font-size:12px;}"
                     "QPushButton:hover { background-color:#4f4f52; }"
                     "QPushButton:checked { background-color:#007ACC; color:white; }"
                     "QPushButton:disabled { background-color:#303033; color:#666; }")
        self.mode_button.setStyleSheet(btn_style); self.prev_doc_button.setStyleSheet(btn_style); self.next_doc_button.setStyleSheet(btn_style)
        self.mode_button.setEnabled(False); self.prev_doc_button.setEnabled(False); self.next_doc_button.setEnabled(False)
        nav = QWidget(); nav.setStyleSheet("background-color:#27282c; border-bottom:1px solid #3a3b3e; margin-bottom:3px;")
        h = QHBoxLayout(nav); h.setContentsMargins(6,4,6,4); h.setSpacing(6)
        for w in (self.mode_button, self.prev_doc_button, self.next_doc_button): h.addWidget(w)
        h.addStretch(); h.addWidget(self.doc_counter_label)
        return nav

    def _toggle_view_mode(self):
        if not self.docs_list: return
        self.current_mode="all" if self.mode_button.isChecked() else "doc"
        self.mode_button.setText("📚 All" if self.current_mode=="all" else "📄 Doc")
        self.prev_doc_button.setEnabled(self.current_mode=="doc" and len(self.docs_list)>1)
        self.next_doc_button.setEnabled(self.current_mode=="doc" and len(self.docs_list)>1)
        self._refresh_left_pane(); self._render_center_right_panes()

    def _switch_document(self, step: int):
        if self.current_mode!="doc" or not self.docs_list or len(self.docs_list)<=1: return
        self.current_doc_idx=(self.current_doc_idx+step)%len(self.docs_list)
        self._refresh_left_pane(); self._render_center_right_panes()

    def _refresh_left_pane(self):
        self.class_list_widget.clear()
        if not self.docs_list:
            self.doc_counter_label.setText("Doc 0/0")
            self.mode_button.setEnabled(False); self.prev_doc_button.setEnabled(False); self.next_doc_button.setEnabled(False)
            return
        self.mode_button.setEnabled(True)
        self.prev_doc_button.setEnabled(self.current_mode=="doc" and len(self.docs_list)>1)
        self.next_doc_button.setEnabled(self.current_mode=="doc" and len(self.docs_list)>1)
        counted:Counter[str]=Counter()
        if self.current_mode=="doc":
            lbl=self.docs_list[self.current_doc_idx]
            for cls,paras in self.by_doc[lbl].items():
                if paras: counted[cls]+=len(paras)
            self.doc_counter_label.setText(f"Doc {self.current_doc_idx+1}/{len(self.docs_list)}")
        else:
            for lbl_key in self.docs_list:
                for cls,paras in self.by_doc[lbl_key].items():
                    if paras: counted[cls]+=len(paras)
            self.doc_counter_label.setText(f"All {len(self.docs_list)} Docs")
        for cls_name in sorted(counted.keys()): self.class_list_widget.addItem(QListWidgetItem(f"{cls_name} ({counted[cls_name]})"))
        if self.class_list_widget.count()>0: self.class_list_widget.setCurrentRow(0)
        else: self._render_center_right_panes() # Render empty if no classes

    def _render_center_right_panes(self, _=None):
        item=self.class_list_widget.currentItem()
        if not item or not self.docs_list:
            msg="No data/docs." if not self.docs_list else "Select class."
            self.text_view_browser.setHtml(f"<html><head>{PHRASE_EXPLORER_CSS}</head><body><div class='page-content'><p>{msg}</p></div></body></html>")
            self.ref_view_browser.setHtml(f"<html><head>{PHRASE_EXPLORER_CSS}</head><body><div class='ref-page-content'><h2>Refs</h2></div></body></html>")
            return
        cls_name=item.text().split(" (")[0]; html_c:List[str]=[]; notes_c:List[str]=[]
        if self.current_mode=="doc":
            lbl=self.docs_list[self.current_doc_idx]; meta_d=self.meta.get(lbl,{})
            html_c.append(f"<h1>{self._format_doc_header(meta_d)}</h1>")
            self._append_and_process_paragraphs(html_c,self.by_doc.get(lbl,{}).get(cls_name,[]),notes_c)
        else:
            any_c=False
            for lbl in self.docs_list:
                paras=self.by_doc.get(lbl,{}).get(cls_name,[])
                if not paras: continue
                any_c=True; meta_d=self.meta.get(lbl,{})
                html_c.append(f"<h2>{self._format_doc_header(meta_d)}</h2>")
                self._append_and_process_paragraphs(html_c,paras,notes_c)
            if not any_c: html_c.append(f"<p>No '{cls_name}' in any doc.</p>")
        self.text_view_browser.setHtml(f"<html><head>{PHRASE_EXPLORER_CSS}</head><body><div class='page-content'>{''.join(html_c)}</div></body></html>")
        self.text_view_browser.moveCursor(QTextCursor.MoveOperation.Start)
        self._fill_right_reference_pane(notes_c)

    @staticmethod
    def _format_doc_header(m:Dict[str,str])->str:
        a=_html_module.escape(m.get("authors","?"),False);y_raw=m.get("year","?");y_m=re.search(r'\d{4}',y_raw);y=y_m.group(0)if y_m else y_raw
        t=_html_module.escape(m.get("title","?"),False); return f"{a} ({y}) – <i>{t}</i>"

    def _append_and_process_paragraphs(self, out:list[str],paras:list[str],notes:list[str]):
        for p_html in paras:
            s=BeautifulSoup(p_html,"html.parser")
            for tn in s.find_all(string=True,recursive=True):
                if isinstance(tn,NavigableString)and'\n'in tn: tn.replace_with(re.sub(r'\s*\n\s*',' ',tn.strip()))
            for sup in s.find_all("sup"):
                a=sup.find("a",href=lambda h:h and h.startswith("#"),title=True)
                if a: n_txt=a["title"].strip();idx=len(notes)+1;notes.append(n_txt);a["href"]=f"#ref-{idx}";a.string=f"[{idx}]"
            out.append(f"<p>{s.decode_contents()}</p>")

    def _fill_right_reference_pane(self, notes:List[str]):
        if not notes: self.ref_view_browser.setHtml(PHRASE_EXPLORER_CSS+"<body><div class='ref-page-content'><h2>Refs</h2><p>N/A</p></div></body>"); return
        h_p=["<html><head>",PHRASE_EXPLORER_CSS,"</head><body><div class='ref-page-content'>",f"<h2>Refs ({len(notes)})</h2><ol class='ref-list'>"]
        for i,txt in enumerate(notes,1): h_p.append(f'<li id="ref-{i}">{_html_module.escape(txt)}</li>')
        h_p.append("</ol></div></body></html>"); self.ref_view_browser.setHtml("".join(h_p)); self.ref_view_browser.moveCursor(QTextCursor.MoveOperation.Start)

    def _handle_text_view_anchor_click(self, url:QUrl):
        s=url.scheme();f=url.fragment()
        if s in["zotero","http","https","file"]:QDesktopServices.openUrl(url)
        elif f and f.startswith("ref-"):self._jump_to_reference_in_right_pane(f)
        else: QDesktopServices.openUrl(url)

    def _jump_to_reference_in_right_pane(self, frag:str): self.ref_view_browser.scrollToAnchor(frag)