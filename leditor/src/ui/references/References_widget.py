import json
import re
from pathlib import Path

from PyQt6.QtCore import QObject, QUrl, pyqtSlot, QTimer
from PyQt6.QtQml import QJSValue
from PyQt6.QtWebChannel import QWebChannel

from PyQt6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile, QWebEngineSettings
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtWidgets import QDialog, QVBoxLayout, QWidget

from Z_Corpus_analysis.help_functions import _load_or_build_records, _load_direct_quote_lookup, \
    _ensure_bibliography_store_exists, _ensure_bib_bibliographic_exists
from bibliometric_analysis_tool.core.app_constants import TINYMCE_HTML, TINY_REF_HTML, _bib_store_path, \
    _bib_bibliographic_path


class _MiniTinyBridge(QObject):
    """
    Bridge for editor.html via QWebChannel object name 'pyBridge'.

    Exposes ref actions used by TinyMCE Tools menu:
      - openRefPicker()
      - insertBibliography()
      - setBibliographyStyle(style)
      - updateBibliographyFromEditor(cb)
    """

    def __init__(
        self,
        parent: QObject,
        *,
        editor: "MiniTinyMceEditor",
        direct_quote_lookup_json: str | Path,
        collection_name: str,
    ):
        super().__init__(parent)
        self._editor = editor
        self._db_path = Path(direct_quote_lookup_json).resolve()
        self._collection_name = str(collection_name or "").strip()
        self._store_path = _bib_store_path(self._collection_name)

        _ensure_bibliography_store_exists(self._store_path)

        self._records = _load_or_build_records(
            direct_quote_lookup_json=self._db_path,
            collection_name=self._collection_name,
        )

    @pyqtSlot(str)
    def openRefPickerWithPreselect(self, json_str: str) -> None:
        obj = json.loads(str(json_str or "{}"))
        keys = obj["item_keys"]

        self._editor.__dict__["_tiny_ref_preselect_item_keys"] = keys
        self.openRefPicker()

    def _consume_preselect_item_keys(self) -> list[str]:
        keys = self._editor.__dict__.get("_tiny_ref_preselect_item_keys")
        self._editor.__dict__["_tiny_ref_preselect_item_keys"] = None
        return keys

    @pyqtSlot()
    def ping(self) -> None:
        print("[MiniTinyMCE] ping")

    @pyqtSlot()
    def openRefPicker(self) -> None:
        self._editor.run_js(
            "(function(){"
            "  if(!(window.tinymce && tinymce.activeEditor)) return;"
            "  var ed = tinymce.activeEditor;"
            "  ed.focus();"
            "  if(!window.__annotarium_insert_bookmark){"
            "    window.__annotarium_insert_bookmark = ed.selection.getBookmark(2, true);"
            "  }"
            "})()"
        )

        preselect = self._consume_preselect_item_keys()

        dlg = HtmlRefDialog(
            editor=self._editor,
            direct_quote_lookup_json=self._db_path,
            collection_name=self._collection_name,
            parent=self._editor,
            title="Tiny Ref",
            preselect_item_keys=preselect,
        )
        dlg.setModal(False)
        self.__dict__["_tiny_ref_dialog"] = dlg
        dlg.show()

    from PyQt6.QtCore import pyqtSlot

    @pyqtSlot("QVariant")
    def getEditorBodyHtml(self, cb) -> None:
        self._editor.get_body_html(lambda body_html: cb.call([str(body_html or "")]))

    @pyqtSlot()
    def insertBibliography(self) -> None:
        bridge = _TinyRefBridge(
            records=self._records,
            store_path=self._store_path,
            editor=self._editor,
            parent=self,
            collection_name=self._collection_name,
            close_fn=None,
            direct_quote_lookup_json=self._db_path,
        )
        bridge.insertBibliography()

    @pyqtSlot(str)
    def setBibliographyStyle(self, style: str) -> None:
        raw = self._store_path.read_text(encoding="utf-8")
        st = json.loads(str(raw or "{}"))
        st["style"] = str(style or "apa")
        self._store_path.parent.mkdir(parents=True, exist_ok=True)
        self._store_path.write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")
        print("[MiniTinyMCE][REFS][STYLE] setBibliographyStyle=", str(style or "apa"))

        dlg = self.__dict__.get("_tiny_ref_dialog")
        if dlg and getattr(dlg, "isVisible", None) and dlg.isVisible():
            try:
                dlg._view.page().runJavaScript(
                    "if (window.setStyleFromPy) { window.setStyleFromPy("
                    + json.dumps(str(style or "apa"), ensure_ascii=False)
                    + "); }"
                )
            except Exception as exc:
                print("[MiniTinyMCE][REFS][STYLE] sync picker failed:", exc)

    @pyqtSlot(result=str)
    def getBibliographyStyle(self) -> str:
        raw = self._store_path.read_text(encoding="utf-8")
        st = json.loads(str(raw or "{}"))
        return str(st.get("style") or "apa")

    @pyqtSlot("QVariant")
    def updateBibliographyFromEditor(self, cb) -> None:
        """
        ###1. Log entry so we can prove the JS menu item is reaching Python
        ###2. Delegate to HtmlPreviewDialog to perform the actual update (single source of truth)
        NOTE: cb must be passed through unchanged (QtWebChannel callback object; supports cb.call([...])).
        """
        def _extract_item_keys_from_html(html: str) -> list[str]:
            out: list[str] = []
            seen: set[str] = set()
            s = str(html or "")

            def push(k: str) -> None:
                kk = str(k or "").strip()
                if kk == "" or kk in seen:
                    return
                seen.add(kk)
                out.append(kk)

            def push_group(g: str) -> None:
                raw = str(g or "")
                for part in raw.split(";"):
                    push(part)

            for m in re.finditer(r"\bdata-item-keys\s*=\s*['\"]([^'\"]+)['\"]", s, flags=re.IGNORECASE):
                push_group(m.group(1))
            for m in re.finditer(r"\bdata-item-key\s*=\s*['\"]([^'\"]+)['\"]", s, flags=re.IGNORECASE):
                push(m.group(1))
            for m in re.finditer(r"\bdata-key\s*=\s*['\"]([^'\"]+)['\"]", s, flags=re.IGNORECASE):
                push(m.group(1))
            for m in re.finditer(r"\bhref\s*=\s*['\"]citegrp://([^'\"]+)['\"]", s, flags=re.IGNORECASE):
                push_group(m.group(1))
            for m in re.finditer(r"\bhref\s*=\s*['\"]cite://([^'\"]+)['\"]", s, flags=re.IGNORECASE):
                push(m.group(1))

            return out

        def _log_and_update(body_html: str) -> None:
            html = str(body_html or "")
            keys = _extract_item_keys_from_html(html)
            print("[MiniTinyMCE][REFS][UPDATE] body_len=", len(html))
            print("[MiniTinyMCE][REFS][UPDATE] keys_n=", len(keys))
            print("[MiniTinyMCE][REFS][UPDATE] keys=", keys)

            bridge = _TinyRefBridge(
                records=self._records,
                store_path=self._store_path,
                editor=self._editor,
                parent=self,
                collection_name=self._collection_name,
                close_fn=None,
                direct_quote_lookup_json=self._db_path,
            )
            bridge.updateFromEditor(cb)

        self._editor.get_body_html(_log_and_update)

    @pyqtSlot(str, QJSValue)
    def updateBibliographyFromEditorWithHtml(self, html: str, cb: QJSValue) -> None:
        s = str(html or "")
        print("[MiniTinyMCE][REFS][UPDATE] body_len=", len(s))

        bridge = _TinyRefBridge(
            records=self._records,
            store_path=self._store_path,
            editor=self._editor,
            parent=self,
            collection_name=self._collection_name,
            close_fn=None,
            direct_quote_lookup_json=self._db_path,
        )
        msg = bridge.updateFromHtml(s)
        cb.call([str(msg)])

    @pyqtSlot(str, str, QJSValue)
    def rebuildCitationsFromHtml(self, html: str, style: str, cb: QJSValue) -> None:
        s = str(html or "")
        st = str(style or "apa")
        bridge = _TinyRefBridge(
            records=self._records,
            store_path=self._store_path,
            editor=self._editor,
            parent=self,
            collection_name=self._collection_name,
            close_fn=None,
            direct_quote_lookup_json=self._db_path,
        )
        msg = bridge.rebuildCitationsFromHtml(s, st)
        cb.call([str(msg)])


class MiniTinyMceEditor(QWidget):
    """
    Standalone TinyMCE editor hosted in a QWebEngineView.
    """

    def __init__(
        self,
        *,
        direct_quote_lookup_json: str | Path,
        collection_name: str,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)

        self._db_path = Path(direct_quote_lookup_json).resolve()
        self._collection_name = str(collection_name or "").strip()

        self._view = QWebEngineView(self)

        self._profile = QWebEngineProfile("mini_tinymce_profile_" + self._collection_name, self)
        ps = self._profile.settings()
        ps.setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)
        ps.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
        ps.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)
        ps.setAttribute(QWebEngineSettings.WebAttribute.LocalStorageEnabled, True)

        self._page = QWebEnginePage(self._profile, self._view)
        self._view.setPage(self._page)

        s = self._view.settings()
        s.setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)
        s.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
        s.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)
        s.setAttribute(QWebEngineSettings.WebAttribute.LocalStorageEnabled, True)

        self._bridge = _MiniTinyBridge(
            self,
            editor=self,
            direct_quote_lookup_json=self._db_path,
            collection_name=self._collection_name,
        )
        self._channel = QWebChannel(self._page)
        self._channel.registerObject("pyBridge", self._bridge)
        self._page.setWebChannel(self._channel)

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.addWidget(self._view, 1)

        self._view.setUrl(QUrl.fromLocalFile(str(TINYMCE_HTML.resolve())))

    def set_body_html(self, body_html: str) -> None:
        js = "window.setBodyHtml(" + json.dumps(str(body_html or ""), ensure_ascii=False) + ");"
        self._page.runJavaScript(js)

    def get_body_html(self, callback) -> None:
        self._page.runJavaScript("window.getBodyHtml();", callback)

    def insert_plain_text(self, text: str) -> None:
        t = str(text or "")
        js = (
            "(function(){"
            "  var s = " + json.dumps(t, ensure_ascii=False) + ";"
            "  if (window.tinymce && tinymce.activeEditor) {"
            "    tinymce.activeEditor.insertContent(s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\n/g,'<br/>'));"
            "    return 'OK_TINYMCE';"
            "  }"
            "  return 'NO_TINYMCE';"
            "})()"
        )
        self._page.runJavaScript(js)

    def insert_html(self, html: str) -> None:
        h = str(html or "")
        js = (
            "(function(){"
            "  var s = " + json.dumps(h, ensure_ascii=False) + ";"
            "  if (window.tinymce && tinymce.activeEditor) {"
            "    tinymce.activeEditor.insertContent(s);"
            "    return 'OK_TINYMCE';"
            "  }"
            "  return 'NO_TINYMCE';"
            "})()"
        )
        self._page.runJavaScript(js)

    def run_js(self, js: str, callback=None) -> None:
        self._page.runJavaScript(str(js or ""), callback)

    @property
    def webview(self) -> QWebEngineView:
        return self._view

    # In your MiniTinyMceEditor wrapper (where get_body_html exists)
    def get_selection_html(self, cb):
        js = (
            "(function(){"
            "  try{"
            "    if(!(window.tinymce && tinymce.activeEditor)) return '';"
            "    var ed = tinymce.activeEditor;"
            "    var html = ed.selection.getContent({format:'html'});"
            "    return String(html||'');"
            "  }catch(e){ return ''; }"
            "})()"
        )
        self.run_js(js, cb)  # use your existing run_js-with-callback facility


class _TinyRefBridge(QObject):
    """
    Bridge expected by ref_picker.html via QWebChannel object name 'pyBridge'.

    Identity is item_key (not dqid).
    Inserted citations use data-item-key in the editor.

    Methods:
      - getRefIndexJson() -> lightweight index array (item-level)
      - getRefByItemKeyJson(item_key) -> full item record payload
      - getPreselectItemKeysJson() -> JSON list of item_key strings to preselect in the UI
      - saveBibliographyStoreJson(json_str)
      - insertCitationJson(json_str) -> expects {item_key, page, style} OR {style, items:[...]}
      - insertBibliography()
      - closeDialog()
    """
    def __init__(
            self,
            *,
            records: list[dict],
            store_path: Path,
            editor: MiniTinyMceEditor,
            parent: QObject,
            collection_name: str,
            direct_quote_lookup_json: Path,
            close_fn=None,
            preselect_item_keys: list[str] | None = None,
    ):
        super().__init__(parent)
        self._records = records
        self._store_path = store_path
        self._editor = editor
        self._close_fn = close_fn
        self._collection_name = str(collection_name or "").strip()
        self._bib_biblio_path = _bib_bibliographic_path(self._collection_name)
        self._dq_lookup_path = Path(direct_quote_lookup_json).resolve()
        self._dq_lookup = _load_direct_quote_lookup(self._dq_lookup_path)

        self._records_map: dict[str, dict] = {}
        i = 0
        while i < len(records):
            pl = records[i]
            item_key = str(pl["item_key"]).strip()
            self._records_map[item_key] = pl
            i += 1

        self._index: list[dict] = []
        j = 0
        while j < len(records):
            pl2 = records[j]
            self._index.append(
                {
                    "item_key": str(pl2.get("item_key") or ""),
                    "author_summary": str(pl2.get("author_summary") or ""),
                    "first_author_last": str(pl2.get("first_author_last") or ""),
                    "year": str(pl2.get("year") or ""),
                    "title": str(pl2.get("title") or ""),
                    "source": str(pl2.get("source") or ""),
                    "url": pl2.get("url"),
                }
            )
            j += 1

        # --- Preselect wiring (from HtmlRefDialog -> picker UI) ---
        ks_in = preselect_item_keys or []
        ks_out: list[str] = []
        seen: dict[str, int] = {}

        k = 0
        while k < len(ks_in):
            key = str(ks_in[k] or "").strip()
            if key and key not in seen:
                if key in self._records_map:
                    ks_out.append(key)
                seen[key] = 1
            k += 1

        self.__dict__["_preselect_item_keys"] = ks_out

        _ensure_bibliography_store_exists(self._store_path)
        _ensure_bib_bibliographic_exists(self._bib_biblio_path)

    @pyqtSlot(result=str)
    def getPreselectItemKeysJson(self) -> str:
        ks = self.__dict__["_preselect_item_keys"]
        return json.dumps(ks, ensure_ascii=False)

    def _author_chunks(self, author_summary: str) -> list[str]:
        s = str(author_summary or "").strip()

        out: list[str] = []
        for chunk in s.split(";"):
            c = chunk.strip()
            if c != "":
                out.append(c)
        return out

    def _author_last(self, author_chunk: str) -> str:
        toks = str(author_chunk or "").strip().split()
        return str(toks[-1] if toks else "").strip()

    def _author_summary_clean(self, author_summary: str) -> str:
        parts = self._author_chunks(author_summary)
        return "; ".join(parts)

    def _apa_in_text_author(self, author_summary: str) -> str:
        parts = self._author_chunks(author_summary)

        if len(parts) == 0:
            return ""

        if len(parts) == 1:
            return self._author_last(parts[0])

        if len(parts) == 2:
            return self._author_last(parts[0]) + " & " + self._author_last(parts[1])

        return self._author_last(parts[0]) + " et al."

    def _update_from_html(self, html: str) -> str:
        import re

        html = str(html or "")
        style = self._store_style()

        print("[TinyRef][UPDATE] body_html_len=", len(html))
        print("[TinyRef][UPDATE] style=", style)

        # ---- Debug: top 10 dq anchors' data-key (one per line) ----
        dq_keys: list[str] = []
        m_dq = re.finditer(
            r"<a\b[^>]*\bhref\s*=\s*['\"]dq://[^'\"]+['\"][^>]*>",
            html,
            flags=re.IGNORECASE,
        )
        for m in m_dq:
            frag = m.group(0)

            m_k = re.search(r"\bdata-key\s*=\s*['\"]([^'\"]+)['\"]", frag, flags=re.IGNORECASE)
            if m_k:
                dq_keys.append(str(m_k.group(1) or "").strip())
            else:
                m_ok = re.search(r"\bdata-orig-href\s*=\s*['\"]([^'\"]+)['\"]", frag, flags=re.IGNORECASE)
                if m_ok:
                    dq_keys.append(str(m_ok.group(1) or "").strip())
                else:
                    dq_keys.append("")

        print("[TinyRef][UPDATE] dq_anchor_keys_n=", len(dq_keys))
        i_dbg = 0
        while i_dbg < len(dq_keys) and i_dbg < 10:
            print("[TinyRef][UPDATE] dq_key_" + str(i_dbg) + ":", dq_keys[i_dbg])
            i_dbg += 1

        # ---- Debug: top 10 annotarium-cite anchors (if any) ----
        cite_anchors = self._extract_citation_anchors(html)
        print("[TinyRef][UPDATE] cite_anchors_n=", len(cite_anchors))
        i_ca = 0
        while i_ca < len(cite_anchors) and i_ca < 10:
            a = cite_anchors[i_ca]
            print("[TinyRef][UPDATE] cite_anchor_" + str(i_ca) + ": href=" + str(a.get("href") or ""))
            print("[TinyRef][UPDATE] cite_anchor_" + str(i_ca) + ": data_item_keys=" + str(
                a.get("data_item_keys") or ""))
            print("[TinyRef][UPDATE] cite_anchor_" + str(i_ca) + ": data_item_key=" + str(
                a.get("data_item_key") or ""))
            print("[TinyRef][UPDATE] cite_anchor_" + str(i_ca) + ": text=" + str(a.get("text") or ""))
            i_ca += 1

        keys = self._extract_item_keys_from_html(html)
        print("[TinyRef][UPDATE] keys_n=", len(keys))
        print("[TinyRef][UPDATE] keys=", keys)

        seen: dict[str, int] = {}
        ordered: list[str] = []
        i = 0
        while i < len(keys):
            k = str(keys[i] or "").strip()
            if k and k not in seen:
                ordered.append(k)
                seen[k] = 1
            i += 1

        n_seen = len(ordered)
        n_written = 0

        index_map: dict[str, int] = {}
        if style == "numeric" or style == "footnote":
            used: set[int] = set()
            next_idx = self._bib_next_index()

            for k_idx in ordered:
                existing = self._bib_index_existing(k_idx)
                if existing and int(existing) not in used:
                    idx = int(existing)
                else:
                    idx = int(next_idx)
                    next_idx += 1
                used.add(int(idx))
                index_map[k_idx] = int(idx)

            raw = self._store_path.read_text(encoding="utf-8")
            st = json.loads(str(raw or "{}"))
            st["numeric_map"] = index_map
            st["numeric_next"] = int(next_idx)
            self._store_path.write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")

            dup_idx: dict[int, list[str]] = {}
            for k_dbg, v_dbg in index_map.items():
                dup_idx.setdefault(int(v_dbg), []).append(k_dbg)
            collisions = {k: v for k, v in dup_idx.items() if len(v) > 1}
            if collisions:
                print("[TinyRef][REINDEX] duplicate indices detected:", collisions)
            else:
                print("[TinyRef][REINDEX] indices unique, total=", len(index_map))

        j = 0
        while j < len(ordered):
            item_key = ordered[j]
            pl = self._records_map[item_key]

            if style == "numeric" or style == "footnote":
                idx = int(index_map.get(item_key) or self._numeric_ensure(item_key))
            else:
                idx = self._bib_index_for(item_key)

            if style == "numeric":
                in_text = "[" + str(idx) + "]"
            elif style == "footnote":
                in_text = str(idx)
            else:
                in_text = self._apa_in_text(pl, "")

            self._bib_upsert(
                item_key=item_key,
                index=int(idx),
                style=style,
                page="",
                pl=pl,
                in_text=in_text,
            )

            n_written += 1
            j += 1

        if style == "numeric" or style == "footnote":
            self._persist_numeric_state()

        msg = "Updated " + str(n_written) + " / " + str(n_seen) + " cited items"
        print("[TinyRef][UPDATE] done:", msg)

        # Refresh the References section from the updated store.
        try:
            self.insertBibliography()
            print("[TinyRef][UPDATE] refs: insertBibliography() triggered")
        except Exception as exc:
            print("[TinyRef][UPDATE] refs: insertBibliography() failed:", exc)

        return msg

    @pyqtSlot(str, result=str)
    def updateFromHtml(self, html: str) -> str:
        return self._update_from_html(html)

    @pyqtSlot(QJSValue)
    def updateFromEditor(self, cb: QJSValue) -> None:
        """
        ###1. Pull full editor BODY html
        ###2. Extract item_keys from HTML (data-item-keys, citegrp://, dq://, zotero://select, item_key=, data-key)
        ###3. Upsert each item into bibliography_store.json + bib_bibliographic.json keyed by item_key
        ###4. Return a status string to JS callback
        """
        def _done(msg: str) -> None:
            cb.call([str(msg)])

        def _on_html(body_html: str) -> None:
            msg = self._update_from_html(body_html or "")
            _done(msg)

        self._editor.get_body_html(_on_html)

    def rebuildCitationsFromHtml(self, html: str, style: str) -> str:
        from bs4 import BeautifulSoup

        s = str(html or "")
        if s.strip() == "":
            return s

        st = json.loads(str(self._store_path.read_text(encoding="utf-8") or "{}"))
        store_items = st.get("items") or []

        meta_map: dict[str, dict] = {}
        for it in store_items:
            if "item_key" in it:
                k = str(it.get("item_key") or "").strip()
            else:
                k = str(it.get("id") or "").strip()
            if k:
                meta_map[k] = it

        soup = BeautifulSoup(s, "html.parser")
        anchors = soup.select("a.annotarium-cite[data-item-key],a.annotarium-cite[data-item-keys]")

        def _keys_from_anchor(a0):
            ks = []
            g = a0.get("data-item-keys")
            if g:
                for part in str(g).split(";"):
                    p = part.strip()
                    if p:
                        ks.append(p)
            else:
                k0 = str(a0.get("data-item-key") or "").strip()
                if k0:
                    ks.append(k0)
            return ks

        def _items_from_anchor(a0, keys0):
            raw = a0.get("data-cite-items")
            if raw:
                try:
                    import html as _html
                    payload = json.loads(_html.unescape(str(raw)))
                    if isinstance(payload, list):
                        out_items = []
                        for it in payload:
                            if not isinstance(it, dict):
                                continue
                            k = str(it.get("item_key") or "").strip()
                            if k:
                                out_items.append(it)
                        if out_items:
                            return out_items
                except Exception:
                    pass

            out = []
            for k in keys0:
                meta = meta_map.get(k) or {}
                out.append(
                    {
                        "item_key": k,
                        "page": str(meta.get("page") or ""),
                        "prefix": str(meta.get("prefix") or ""),
                        "suffix": str(meta.get("suffix") or ""),
                        "omit_author": bool(meta.get("omit_author") or False),
                    }
                )
            return out

        for a in anchors:
            keys = _keys_from_anchor(a)
            if not keys:
                continue
            items = _items_from_anchor(a, keys)

            if style == "apa":
                parts = []
                for it in items:
                    k = str(it.get("item_key") or "").strip()
                    if not k:
                        continue
                    pl = self._records_map.get(k) or {}
                    cit = self._apa_in_text(pl, str(it.get("page") or ""))
                    cit = self._apa_omit_author_with_flag(cit, bool(it.get("omit_author") or False))
                    cit = self._apply_prefix_suffix(cit, str(it.get("prefix") or ""), str(it.get("suffix") or ""))
                    t = str(cit or "").strip()
                    if t.startswith("(") and t.endswith(")"):
                        t = t[1:-1].strip()
                    parts.append(t)
                group_text = "(" + "; ".join(parts) + ")"
                if len(keys) > 1:
                    a["data-item-keys"] = ";".join(keys)
                    a.attrs.pop("data-item-key", None)
                    a["href"] = "citegrp://" + ";".join(keys)
                else:
                    a["data-item-key"] = keys[0]
                    a.attrs.pop("data-item-keys", None)
                    a["href"] = "cite://" + keys[0]
                a["data-cite-items"] = json.dumps(items, ensure_ascii=False)
                a["data-cite-style"] = "apa"
                a.string = group_text
                if a.parent and a.parent.name == "sup":
                    a.parent.replace_with(a)

            elif style == "numeric":
                nums = []
                for it in items:
                    k = str(it.get("item_key") or "").strip()
                    if not k:
                        continue
                    nums.append(int(self._numeric_ensure(k)))
                pieces = ["[" + str(n) + "]" for n in nums]
                group_text = "".join(pieces)
                if len(keys) > 1:
                    a["data-item-keys"] = ";".join(keys)
                    a.attrs.pop("data-item-key", None)
                    a["href"] = "citegrp://" + ";".join(keys)
                else:
                    a["data-item-key"] = keys[0]
                    a.attrs.pop("data-item-keys", None)
                    a["href"] = "cite://" + keys[0]
                a["data-cite-items"] = json.dumps(items, ensure_ascii=False)
                a["data-cite-style"] = "numeric"
                a.string = group_text
                if a.parent and a.parent.name == "sup":
                    a.parent.replace_with(a)
                self._persist_numeric_state()

            else:  # footnote
                frags = []
                for k in keys:
                    n = int(self._numeric_ensure(k))
                    item_payload = json.dumps(
                        [
                            {
                                "item_key": k,
                                "page": str((meta_map.get(k) or {}).get("page") or ""),
                                "prefix": str((meta_map.get(k) or {}).get("prefix") or ""),
                                "suffix": str((meta_map.get(k) or {}).get("suffix") or ""),
                                "omit_author": bool((meta_map.get(k) or {}).get("omit_author") or False),
                            }
                        ],
                        ensure_ascii=False,
                    )
                    frag = (
                        "<sup><a class='annotarium-cite' contenteditable='false' data-cite-style='footnote' "
                        "data-cite-items='" + self._esc(item_payload) + "' "
                        "data-item-key='" + self._esc(k) + "' href='cite://" + self._esc(k) + "'>"
                        + self._esc(str(n)) + "</a></sup>"
                    )
                    frags.append(frag)
                html_frag = "".join(frags)
                rep = BeautifulSoup(html_frag, "html.parser")
                if a.parent and a.parent.name == "sup":
                    a.parent.replace_with(rep)
                else:
                    a.replace_with(rep)
                self._persist_numeric_state()

        body = soup.body
        return body.decode_contents() if body else str(soup)

    def _extract_citation_anchors(self, html: str) -> list[dict]:
        """
        ###Extract annotarium cite anchors from html.
        Returns list of dicts with data-item-keys / data-item-key / href / text.
        """
        import re

        out: list[dict] = []
        s = str(html or "")

        pat = re.compile(r"<a\b[^>]*class=['\"][^'\"]*annotarium-cite[^'\"]*['\"][^>]*>.*?</a>",
                         re.IGNORECASE | re.DOTALL)
        matches = list(pat.finditer(s))

        i = 0
        while i < len(matches):
            frag = matches[i].group(0)

            m_keys = re.search(r"data-item-keys=['\"]([^'\"]+)['\"]", frag, re.IGNORECASE)
            m_key = re.search(r"data-item-key=['\"]([^'\"]+)['\"]", frag, re.IGNORECASE)
            m_href = re.search(r"href=['\"]([^'\"]+)['\"]", frag, re.IGNORECASE)
            m_txt = re.search(r">([^<]*)<", frag, re.DOTALL)

            out.append(
                {
                    "data_item_keys": m_keys.group(1) if m_keys else "",
                    "data_item_key": m_key.group(1) if m_key else "",
                    "href": m_href.group(1) if m_href else "",
                    "text": (m_txt.group(1) if m_txt else "").strip(),
                }
            )
            i += 1

        return out
    def _store_style(self) -> str:
        raw = self._store_path.read_text(encoding="utf-8")
        st = json.loads(str(raw or "{}"))
        return str(st.get("style") or "apa")

    def _ensure_store_has_item_key(
            self,
            *,
            item_key: str,
            page: str = "",
            prefix: str = "",
            suffix: str = "",
            omit_author: bool = False,
    ) -> None:
        raw = self._store_path.read_text(encoding="utf-8")
        st = json.loads(str(raw or "{}"))

        items = st["items"]

        found_i = -1
        i = 0
        while i < len(items):
            it = items[i]
            if "item_key" in it:
                k = str(it.get("item_key") or "")
            else:
                k = str(it.get("id") or "")
            if k == str(item_key):
                found_i = i
                break
            i += 1

        entry = {
            "item_key": str(item_key),
            "page": str(page or ""),
            "prefix": str(prefix or ""),
            "suffix": str(suffix or ""),
            "omit_author": bool(omit_author),
        }

        if found_i >= 0:
            items[found_i] = entry
        else:
            items.append(entry)

        st["items"] = items
        self._store_path.write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")

    def _extract_item_keys_from_html(self, html: str) -> list[str]:
        """
        Extract citation keys from an HTML fragment.
        Supports:
          - data-item-keys="K1;K2"
          - data-item-key="K1"
          - href="citegrp://K1;K2"
          - href="cite://K1"
          - data-key="K1" (dq anchors in your exports)
        Returns unique keys in first-seen order.
        """
        import re

        s = str(html or "")
        out: list[str] = []
        seen: set[str] = set()

        def push(k: str) -> None:
            kk = str(k or "").strip()
            if kk == "":
                return
            if kk in seen:
                return
            seen.add(kk)
            out.append(kk)

        def push_group(g: str) -> None:
            raw = str(g or "")
            for part in raw.split(";"):
                push(part)

        # data-item-keys="A;B"
        for m in re.finditer(r"\bdata-item-keys\s*=\s*['\"]([^'\"]+)['\"]", s, flags=re.IGNORECASE):
            push_group(m.group(1))

        # data-item-key="A"
        for m in re.finditer(r"\bdata-item-key\s*=\s*['\"]([^'\"]+)['\"]", s, flags=re.IGNORECASE):
            push(m.group(1))

        # data-key="A" (your dq anchors currently carry this)
        for m in re.finditer(r"\bdata-key\s*=\s*['\"]([^'\"]+)['\"]", s, flags=re.IGNORECASE):
            push(m.group(1))

        # href="citegrp://A;B"
        for m in re.finditer(r"\bhref\s*=\s*['\"]citegrp://([^'\"]+)['\"]", s, flags=re.IGNORECASE):
            push_group(m.group(1))

        # href="cite://A"
        for m in re.finditer(r"\bhref\s*=\s*['\"]cite://([^'\"]+)['\"]", s, flags=re.IGNORECASE):
            push(m.group(1))

        return out

    @pyqtSlot(result="QVariant")
    def getRefIndex(self):
        return self._index

    @pyqtSlot(str, result="QVariant")
    def getRefByItemKey(self, item_key: str):
        return self._records_map[str(item_key or "")]

    @pyqtSlot(result="QVariant")
    def getRefRecords(self):
        return self._records

    # ---------------- JSON-string APIs ----------------

    @pyqtSlot(result=str)
    def getRefIndexJson(self) -> str:
        return json.dumps(self._index, ensure_ascii=False)

    @pyqtSlot(str, result=str)
    def getRefByItemKeyJson(self, item_key: str) -> str:
        pl = self._records_map[str(item_key or "")]
        return json.dumps(pl, ensure_ascii=False)

    @pyqtSlot(result=str)
    def getRefRecordsJson(self) -> str:
        return json.dumps(self._records, ensure_ascii=False)

    @pyqtSlot(str)
    def saveBibliographyStoreJson(self, json_str: str) -> None:
        p = self._store_path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(str(json_str or ""), encoding="utf-8")

    @pyqtSlot(result=str)
    def getBibliographyStyle(self) -> str:
        return self._store_style()

    @pyqtSlot(str)
    def insertCitationJson(self, json_str: str) -> None:
        """
        Input JSON expects either:

        Single:
          {
            item_key: "...",
            page: "...",
            prefix: "...",
            suffix: "...",
            omit_author: true|false,
            style: "apa|numeric|footnote"
          }

        Multi:
          {
            style: "apa|numeric|footnote",
            items: [
              { item_key, page, prefix, suffix, omit_author },
              ...
            ]
          }

        Insertion contract:
          - Always inserts a single atomic HTML node.
          - The node is contenteditable=false (non-editable) and styled to be indistinguishable from body text.
          - Backspace/Delete near/inside the node removes the whole citation node (Zotero-like).

        Resulting HTML:
          - APA/numeric:
              <a class="annotarium-cite" contenteditable="false" data-item-keys="K1;K2" href="citegrp://K1;K2">(…; …)</a>
            (for single it will still use data-item-keys with one key)
          - footnote:
              <sup><a class="annotarium-cite" ...>n</a></sup>
            (multi footnote will insert multiple sup nodes in one atomic span, separated by nothing)
        """
        obj = json.loads(str(json_str or "{}"))

        style = str(obj.get("style") or self._store_style() or "apa")
        print("[TinyRef][INSERT] insertCitationJson style=", style)

        items = obj.get("items")
        if items is None:
            items = [
                {
                    "item_key": str(obj["item_key"] or "").strip(),
                    "page": str(obj.get("page") or "").strip(),
                    "prefix": str(obj.get("prefix") or ""),
                    "suffix": str(obj.get("suffix") or ""),
                    "omit_author": bool(obj.get("omit_author") or False),
                }
            ]

        if style == "apa":
            def _apa_sort_key(it):
                k = str(it.get("item_key") or "").strip()
                pl = self._records_map.get(k) or {}
                author = self._apa_first_author_last(str(pl.get("author_summary") or pl.get("first_author_last") or ""))
                year = str(pl.get("year") or "")
                return (author.lower(), year, k.lower())

            items = sorted(items, key=_apa_sort_key)

        if style == "numeric" or style == "footnote":
            num_map: dict[str, int] = {}
            i_n = 0
            while i_n < len(items):
                k_n = str(items[i_n]["item_key"] or "").strip()
                if k_n != "":
                    num_map[k_n] = int(self._numeric_ensure(k_n))
                i_n += 1

            items = sorted(items, key=lambda it: (num_map.get(str(it.get("item_key") or "").strip(), 0),
                                                 str(it.get("item_key") or "").strip()))

        item_keys_for_node: list[str] = []
        i_keys = 0
        while i_keys < len(items):
            k0 = str(items[i_keys]["item_key"] or "").strip()
            item_keys_for_node.append(k0)
            i_keys += 1

        def _apply_prefix_suffix(text: str, pre: str, suf: str) -> str:
            return self._apply_prefix_suffix(text, pre, suf)

        def _apa_omit_author_with_flag(cit_text: str, omit_flag: bool) -> str:
            return self._apa_omit_author_with_flag(cit_text, omit_flag)

        js_install_guard = (
            "(function(){"
            "  if(!(window.tinymce && tinymce.activeEditor)) return;"
            "  var ed = tinymce.activeEditor;"
            "  if(ed.__annotarium_cite_guard_installed) return;"
            "  ed.__annotarium_cite_guard_installed = true;"
            "  var css = '';"
            "  css += 'a.annotarium-cite{color:inherit !important;text-decoration:none !important;"
            "display:inline !important;background:transparent !important;border:0 !important;"
            "padding:0 !important;margin:0 !important;font:inherit !important;line-height:inherit !important;}'"
            "     + 'a.annotarium-cite:visited{color:inherit !important;}';"
            "  ed.on('PreInit', function(){"
            "    ed.contentStyles.push(css);"
            "  });"
            "  function isCiteEl(n){"
            "    if(!n) return false;"
            "    if(n.nodeType !== 1) return false;"
            "    var el = n;"
            "    var cls = String(el.className || '');"
            "    if(cls.indexOf('annotarium-cite') === -1) return false;"
            "    var ks = el.getAttribute('data-item-keys');"
            "    var k = el.getAttribute('data-item-key');"
            "    return !!(ks || k);"
            "  }"
            "  function closestCite(n){"
            "    var x = n;"
            "    while(x){"
            "      if(isCiteEl(x)) return x;"
            "      x = x.parentNode;"
            "    }"
            "    return null;"
            "  }"
            "  function removeCite(el){"
            "    if(!el) return;"
            "    var key = el.getAttribute('data-item-key');"
            "    if(key){"
            "      var body = ed.getBody();"
            "      if(body){"
            "        var lis = body.querySelectorAll('ol[data-annotarium-footnotes] li[data-item-key=\"'+key+'\"]');"
            "        for(var i=0;i<lis.length;i++){"
            "          if(lis[i] && lis[i].parentNode) lis[i].parentNode.removeChild(lis[i]);"
            "        }"
            "        if(window.__annotarium_cleanup_empty_footnotes){"
            "          window.__annotarium_cleanup_empty_footnotes();"
            "        }"
            "      }"
            "    }"
            "    var sup = el.parentNode;"
            "    if(sup && sup.nodeType === 1 && String(sup.nodeName || '').toUpperCase() === 'SUP'){"
            "      sup.parentNode.removeChild(sup);"
            "      if(window.__annotarium_request_ref_rebuild){"
            "        window.__annotarium_request_ref_rebuild('footnote');"
            "      }"
            "      return;"
            "    }"
            "    el.parentNode.removeChild(el);"
            "    if(window.__annotarium_request_ref_rebuild){"
            "      window.__annotarium_request_ref_rebuild('footnote');"
            "    }"
            "  }"
            "  ed.on('keydown', function(ev){"
            "    var k = ev.key;"
            "    if(k !== 'Backspace' && k !== 'Delete') return;"
            "    var rng = ed.selection.getRng();"
            "    var sc = rng.startContainer;"
            "    var cite = closestCite(sc);"
            "    if(cite){"
            "      ev.preventDefault();"
            "      removeCite(cite);"
            "      return;"
            "    }"
            "    if(!rng.collapsed) return;"
            "    if(sc && sc.nodeType === 3){"
            "      var off = rng.startOffset;"
            "      if(k === 'Backspace' && off === 0){"
            "        var prev = sc.previousSibling;"
            "        if(!prev && sc.parentNode) prev = sc.parentNode.previousSibling;"
            "        if(isCiteEl(prev)){"
            "          ev.preventDefault();"
            "          removeCite(prev);"
            "          return;"
            "        }"
            "        var prevC = closestCite(prev);"
            "        if(prevC){"
            "          ev.preventDefault();"
            "          removeCite(prevC);"
            "          return;"
            "        }"
            "      }"
            "      if(k === 'Delete' && off === sc.data.length){"
            "        var nxt = sc.nextSibling;"
            "        if(!nxt && sc.parentNode) nxt = sc.parentNode.nextSibling;"
            "        if(isCiteEl(nxt)){"
            "          ev.preventDefault();"
            "          removeCite(nxt);"
            "          return;"
            "        }"
            "        var nxtC = closestCite(nxt);"
            "        if(nxtC){"
            "          ev.preventDefault();"
            "          removeCite(nxtC);"
            "          return;"
            "        }"
            "      }"
            "    }"
            "  });"
            "})();"
        )

        if style == "apa":
            parts_no_parens: list[str] = []

            i0 = 0
            while i0 < len(items):
                it0 = items[i0]

                item_key0 = str(it0["item_key"] or "").strip()
                page0 = str(it0.get("page") or "").strip()
                prefix0 = str(it0.get("prefix") or "")
                suffix0 = str(it0.get("suffix") or "")
                omit0 = bool(it0.get("omit_author") or False)

                pl0 = self._records_map[item_key0]

                self._ensure_store_has_item_key(
                    item_key=item_key0,
                    page=page0,
                    prefix=prefix0,
                    suffix=suffix0,
                    omit_author=omit0,
                )

                cit0 = self._apa_in_text(pl0, page0)
                cit1 = _apa_omit_author_with_flag(cit0, omit0)
                cit2 = _apply_prefix_suffix(cit1, prefix0, suffix0)

                t = str(cit2 or "").strip()
                if t.startswith("(") and t.endswith(")"):
                    t = t[1:-1].strip()

                parts_no_parens.append(t)

                bib0 = self._apa_biblio(pl0)

                print("[TinyRef][INSERT] style=apa item_key=", item_key0, "| intext=", cit2)
                print("[TinyRef][INSERT] style=apa item_key=", item_key0, "| biblio=", bib0)

                idx0 = self._bib_index_for(item_key0)
                self._bib_upsert(item_key=item_key0, index=int(idx0), style=style, page=page0, pl=pl0, in_text=cit2)

                i0 += 1

            joined = "; ".join(parts_no_parens)
            group_text = "(" + joined + ")"

            keys_joined = ";".join(item_keys_for_node)
            cite_items_json = json.dumps(items, ensure_ascii=False)

            a_html = (
                    "<a"
                    " class='annotarium-cite'"
                    " contenteditable='false'"
                    " data-cite-style='apa'"
                    " data-cite-items='" + self._esc(cite_items_json) + "'"
                    " data-item-keys='" + self._esc(keys_joined) + "'"
                                                                   " href='citegrp://" + self._esc(keys_joined) + "'"
                                                                                                                  ">" + self._esc(
                group_text) + "</a>"
            )

            js = (
                    "(function(){"
                    "  if(!(window.tinymce && tinymce.activeEditor)) return;"
                    + js_install_guard +
                    "  var ed = tinymce.activeEditor;"
                    "  ed.focus();"
                    "  var sel = ed.selection;"
                    "  var hasRange = sel && !sel.isCollapsed();"
                    "  if(!hasRange && window.__annotarium_insert_bookmark){"
                    "    sel.moveToBookmark(window.__annotarium_insert_bookmark);"
                    "  }"
                    "  sel.setContent(" + json.dumps(a_html, ensure_ascii=False) + ");"
                                                                                      "  window.__annotarium_insert_bookmark = null;"
                                                                                      "})()"
            )
            QTimer.singleShot(0, lambda: self._editor.run_js(js))
            return

        if style == "numeric":
            parts_txt: list[str] = []
            i1 = 0
            while i1 < len(items):
                it1 = items[i1]

                item_key1 = str(it1["item_key"] or "").strip()
                page1 = str(it1.get("page") or "").strip()
                prefix1 = str(it1.get("prefix") or "")
                suffix1 = str(it1.get("suffix") or "")
                omit1 = bool(it1.get("omit_author") or False)

                pl1 = self._records_map[item_key1]

                self._ensure_store_has_item_key(
                    item_key=item_key1,
                    page=page1,
                    prefix=prefix1,
                    suffix=suffix1,
                    omit_author=omit1,
                )

                n = self._numeric_ensure(item_key1)
                cit2 = "[" + str(n) + "]"
                cit3 = _apply_prefix_suffix(cit2, prefix1, suffix1)
                bib2 = self._numeric_biblio_entry(pl1, item_key=item_key1, n=int(n))

                parts_txt.append(cit3)

                print("[TinyRef][INSERT] style=numeric item_key=", item_key1, "| intext=", cit3)
                print("[TinyRef][INSERT] style=numeric item_key=", item_key1, "| biblio=", bib2)

                self._bib_upsert(item_key=item_key1, index=int(n), style=style, page=page1, pl=pl1, in_text=cit3)

                i1 += 1

            keys_joined = ";".join(item_keys_for_node)
            cite_items_json2 = json.dumps(items, ensure_ascii=False)

            if len(parts_txt) == 1:
                shown = parts_txt[0]
            else:
                shown = "".join(parts_txt)

            a_html2 = (
                    "<a"
                    " class='annotarium-cite'"
                    " contenteditable='false'"
                    " data-cite-style='numeric'"
                    " data-cite-items='" + self._esc(cite_items_json2) + "'"
                    " data-item-keys='" + self._esc(keys_joined) + "'"
                                                                   " href='citegrp://" + self._esc(keys_joined) + "'"
                                                                                                                  ">" + self._esc(
                shown) + "</a>"
            )

            js2 = (
                    "(function(){"
                    "  if(!(window.tinymce && tinymce.activeEditor)) return;"
                    + js_install_guard +
                    "  var ed = tinymce.activeEditor;"
                    "  ed.focus();"
                    "  var sel = ed.selection;"
                    "  var hasRange = sel && !sel.isCollapsed();"
                    "  if(!hasRange && window.__annotarium_insert_bookmark){"
                    "    sel.moveToBookmark(window.__annotarium_insert_bookmark);"
                    "  }"
                    "  sel.setContent(" + json.dumps(a_html2, ensure_ascii=False) + ");"
                                                                                       "  window.__annotarium_insert_bookmark = null;"
                                                                                       "})()"
            )
            QTimer.singleShot(0, lambda: self._editor.run_js(js2))

            self._persist_numeric_state()
            return

        # footnote
        foot_frag = ""
        i2 = 0
        while i2 < len(items):
            it2 = items[i2]

            item_key2 = str(it2["item_key"] or "").strip()
            page2 = str(it2.get("page") or "").strip()
            prefix2 = str(it2.get("prefix") or "")
            suffix2 = str(it2.get("suffix") or "")
            omit2 = bool(it2.get("omit_author") or False)

            pl2 = self._records_map[item_key2]

            self._ensure_store_has_item_key(
                item_key=item_key2,
                page=page2,
                prefix=prefix2,
                suffix=suffix2,
                omit_author=omit2,
            )

            n2 = self._numeric_ensure(item_key2)
            intext3 = str(n2)
            bib3 = self._footnote_biblio_entry(pl2, str(page2 or ""))

            print("[TinyRef][INSERT] style=footnote item_key=", item_key2, "| intext=", intext3)
            print("[TinyRef][INSERT] style=footnote item_key=", item_key2, "| biblio=", bib3)

            a_html3 = (
                    "<sup>"
                    "<a"
                    " class='annotarium-cite'"
                    " contenteditable='false'"
                    " data-cite-style='footnote'"
                    " data-item-key='" + self._esc(item_key2) + "'"
                                                                " data-page='" + self._esc(page2) + "'"
                                                                                                    " data-prefix='" + self._esc(
                prefix2) + "'"
                           " data-suffix='" + self._esc(suffix2) + "'"
                                                                   " data-omit-author='" + ("1" if omit2 else "0") + "'"
                                                                                                                     " href='cite://" + self._esc(
                item_key2) + "'"
                             ">" + self._esc(intext3) + "</a>"
                                                        "</sup>"
            )

            foot_frag += a_html3

            self._bib_upsert(item_key=item_key2, index=int(n2), style=style, page=page2, pl=pl2, in_text=intext3)

            QTimer.singleShot(0, lambda n=int(n2), k=item_key2, t=bib3: self._editor.run_js(
                self._js_append_footnote_line(n=n, item_key=k, text=t)))

            i2 += 1

        js3 = (
                "(function(){"
                "  if(!(window.tinymce && tinymce.activeEditor)) return;"
                + js_install_guard +
                "  var ed = tinymce.activeEditor;"
                "  ed.focus();"
                "  var sel = ed.selection;"
                "  var selHtml = String(sel.getContent({ format: 'html' }) || '');"
                "  var k0 = " + json.dumps(str(item_keys_for_node[0] if item_keys_for_node else ""), ensure_ascii=False) + ";"
                "  if(k0 && selHtml.indexOf(\"data-item-key='\" + k0 + \"'\") !== -1) { return; }"
                "  var node = sel.getNode ? sel.getNode() : null;"
                "  if(node){"
                "    var a = node.closest ? node.closest('a.annotarium-cite[data-item-key]') : null;"
                "    if(a && String(a.getAttribute('data-item-key')||'') === String(k0||'')) { return; }"
                "  }"
                "  var hasRange = sel && !sel.isCollapsed();"
                "  if(!hasRange && window.__annotarium_insert_bookmark){"
                "    sel.moveToBookmark(window.__annotarium_insert_bookmark);"
                "  }"
                "  sel.setContent(" + json.dumps(foot_frag, ensure_ascii=False) + ");"
                                                                                     "  window.__annotarium_insert_bookmark = null;"
                                                                                     "})()"
        )

        QTimer.singleShot(0, lambda: self._editor.run_js(js3))

        self._persist_numeric_state()
        QTimer.singleShot(0, lambda: self._editor.run_js("if(window.__annotarium_cleanup_empty_footnotes){window.__annotarium_cleanup_empty_footnotes();}"))

    @pyqtSlot()
    def insertBibliography(self) -> None:
        raw = self._store_path.read_text(encoding="utf-8")
        st = json.loads(str(raw or "{}"))

        style = str(st.get("style") or "apa")
        store_items = st["items"]
        print("[TinyRef][INSERT] insertBibliography style=", style)

        entry_map: dict[str, dict] = {}
        i = 0
        while i < len(store_items):
            it = store_items[i]

            if "item_key" in it:
                k = str(it["item_key"] or "").strip()
            elif "id" in it:
                k = str(it["id"] or "").strip()
            else:
                i += 1
                continue

            if k != "":
                entry_map[k] = it
            i += 1

        if style == "footnote":
            bib = self._bib_load()
            entry_map_bib: dict[str, dict] = {}
            for itb in bib.get("items") or []:
                k_b = str(itb.get("id") or "").strip()
                if k_b:
                    entry_map_bib[k_b] = itb

            def _on_html_foot(body_html: str) -> None:
                html = str(body_html or "")
                rebuilt = self._build_body_with_footnotes_per_page(html, entry_map_bib)
                js = "window.setBodyHtml(" + json.dumps(rebuilt, ensure_ascii=False) + ");"
                self._editor.run_js(js)
                self._persist_numeric_state()

            self._editor.get_body_html(_on_html_foot)
            return

        def _on_html(body_html: str) -> None:
            html = str(body_html or "")
            keys = self._extract_item_keys_from_html(html)

            seen: dict[str, int] = {}
            ordered_keys: list[str] = []

            j = 0
            while j < len(keys):
                k2 = keys[j]
                if k2 not in seen:
                    ordered_keys.append(k2)
                    seen[k2] = 1
                j += 1

            norm_items: list[dict] = []
            k = 0
            while k < len(ordered_keys):
                item_key = ordered_keys[k]
                it2 = entry_map.get(item_key) or {}

                norm_items.append(
                    {
                        "item_key": str(item_key),
                        "page": str(it2.get("page") or ""),
                        "prefix": str(it2.get("prefix") or ""),
                        "suffix": str(it2.get("suffix") or ""),
                        "omit_author": bool(it2.get("omit_author") or False),
                    }
                )
                k += 1

            self._editor.run_js(self._js_ensure_refs_section())

            if style == "numeric":
                html_out = self._build_numeric_refs_html(norm_items)
                self._editor.run_js(self._js_set_refs_host_html(html_out))
                self._persist_numeric_state()
                return

            html_out2 = self._build_apa_refs_html(norm_items)
            self._editor.run_js(self._js_set_refs_host_html(html_out2))

        self._editor.get_body_html(_on_html)

    @pyqtSlot()
    def closeDialog(self) -> None:
        if self._close_fn:
            QTimer.singleShot(0, self._close_fn)

    def _bib_load(self) -> dict:
        raw = self._bib_biblio_path.read_text(encoding="utf-8")
        return json.loads(str(raw or "{}"))

    def _bib_save(self, obj: dict) -> None:
        self._bib_biblio_path.parent.mkdir(parents=True, exist_ok=True)
        self._bib_biblio_path.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")

    def _bib_index_for(self, item_key: str) -> int:
        st = self._bib_load()
        items = st["items"]
        i = 0
        while i < len(items):
            it = items[i]
            if str(it["id"]) == str(item_key):
                return int(it["index"])
            i += 1
        return int(self._bib_next_index())

    def _bib_index_existing(self, item_key: str) -> int | None:
        st = self._bib_load()
        items = st["items"]
        i = 0
        while i < len(items):
            it = items[i]
            if str(it["id"]) == str(item_key):
                return int(it["index"])
            i += 1
        return None

    def _bib_next_index(self) -> int:
        st = self._bib_load()
        items = st["items"]
        max_idx = 0
        i = 0
        while i < len(items):
            it = items[i]
            try:
                v = int(it.get("index") or 0)
            except Exception:
                v = 0
            if v > max_idx:
                max_idx = v
            i += 1
        return int(max_idx + 1)

    def _bib_upsert(self, *, item_key: str, index: int, style: str, page: str, pl: dict, in_text: str) -> None:
        st = self._bib_load()
        items = st["items"]

        apa_in_text = self._apa_in_text(pl, str(page or ""))
        numeric_in_text = "[" + str(index) + "]"
        footnote_in_text = str(index)

        biblio_apa = self._apa_biblio(pl)
        biblio_numeric = self._numeric_biblio_entry(pl, item_key=item_key, n=int(index))
        biblio_footnote = self._footnote_biblio_entry(pl, str(page or ""))

        entry = {
            "id": str(item_key),
            "index": int(index),
            "style": str(style),
            "page": str(page or ""),
            "author_summary": str(pl.get("author_summary") or ""),
            "first_author_last": str(pl.get("first_author_last") or ""),
            "year": str(pl.get("year") or ""),
            "title": str(pl.get("title") or ""),
            "source": str(pl.get("source") or ""),
            "url": pl.get("url"),
            "in_text": str(in_text or ""),
            "in_text_apa": str(apa_in_text or ""),
            "in_text_numeric": str(numeric_in_text or ""),
            "in_text_footnote": str(footnote_in_text or ""),
            "biblio_apa": str(biblio_apa or ""),
            "biblio_numeric": str(biblio_numeric or ""),
            "biblio_footnote": str(biblio_footnote or ""),
        }

        found_i = -1
        i = 0
        while i < len(items):
            if str(items[i]["id"]) == str(item_key):
                found_i = i
                break
            i += 1

        if found_i >= 0:
            items[found_i] = entry
        else:
            items.append(entry)

        st["schema"] = "bib_bibliographic_v1"
        st["items"] = items
        self._bib_save(st)

    def _js_ensure_refs_section(self) -> str:
        return (
            "(function(){"
            "var ed=tinymce.activeEditor;"
            "var html=ed.getContent({format:'html'})||'';"
            "if(html.indexOf('<!-- annotarium:refs -->')!==-1){return;}"
            "var block='<p></p><!-- annotarium:refs -->'+"
            "'<h2>References</h2>'+"
            "'<div data-annotarium-refs=\"1\"></div>'+"
            "'<!-- /annotarium:refs -->';"
            "ed.setContent(html+block,{format:'html'});"
            "})()"
        )

    def _js_set_refs_host_html(self, inner_html: str) -> str:
        return (
            "(function(){"
            "var ed=tinymce.activeEditor;"
            "var body=ed.getBody();"
            "var host=body.querySelector('div[data-annotarium-refs=\"1\"]');"
            "if(!host){return;}"
            "host.innerHTML=" + json.dumps(str(inner_html or ""), ensure_ascii=False) + ";"
            "})()"
        )

    def _js_ensure_footnotes_section(self) -> str:
        return (
            "(function(){"
            "var ed=tinymce.activeEditor;"
            "var html=ed.getContent({format:'html'})||'';"
            "if(html.indexOf('<!-- annotarium:footnotes -->')!==-1){return;}"
            "var block='<p></p><!-- annotarium:footnotes -->'+"
            "'<h2>Footnotes</h2>'+"
            "'<ol data-annotarium-footnotes=\"1\"></ol>'+"
            "'<!-- /annotarium:footnotes -->';"
            "ed.setContent(html+block,{format:'html'});"
            "})()"
        )

    def _js_clear_footnotes_section(self) -> str:
        return (
            "(function(){"
            "var ed=tinymce.activeEditor;"
            "var body=ed.getBody();"
            "var ol=body.querySelector('ol[data-annotarium-footnotes=\"1\"]');"
            "if(!ol){return;}"
            "ol.innerHTML='';"
            "})()"
        )

    def _js_append_footnote_line(self, *, n: int, item_key: str, text: str) -> str:
        payload = json.dumps(
            {"n": int(n), "item_key": str(item_key or ""), "text": str(text or "")},
            ensure_ascii=False,
        )
        return (
            "(function(){"
            "if(window.__annotarium_append_footnote_at_cursor){"
            "  window.__annotarium_append_footnote_at_cursor(" + payload + ");"
            "}"
            "})()"
        )

    def _esc(self, s: str) -> str:
        return (
            str(s or "")
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&#039;")
        )

    def _apa_first_author_last(self, author_summary: str) -> str:
        parts = self._author_chunks(author_summary)
        if len(parts) == 0:
            return ""
        return self._author_last(parts[0])

    def _apa_in_text(self, pl: dict, page: str) -> str:
        author_summary = str(pl.get("author_summary") or pl.get("first_author_last") or "").strip()
        year = str(pl.get("year") or "").strip()
        author_part = self._apa_in_text_author(author_summary)
        y = year if year else "n.d."

        p = str(page or "").strip()
        if p:
            if not (p.lower().startswith("p.") or p.lower().startswith("pp.")):
                p = "p. " + p
            if author_part:
                return "(" + author_part + ", " + y + ", " + p + ")"
            return "(" + y + ", " + p + ")"

        if author_part:
            return "(" + author_part + ", " + y + ")"
        return "(" + y + ")"

    def _apply_prefix_suffix(self, text: str, pre: str, suf: str) -> str:
        t = str(text or "")
        p = str(pre or "")
        s = str(suf or "")
        if p:
            if p.endswith(" ") or t.startswith(" "):
                t = p + t
            else:
                t = p + " " + t
        if s:
            if t.endswith(" ") or s.startswith(" "):
                t = t + s
            else:
                t = t + " " + s
        return t

    def _apa_omit_author_with_flag(self, cit_text: str, omit_flag: bool) -> str:
        t = str(cit_text or "")
        if not omit_flag:
            return t

        t2 = t.strip()
        if t2.startswith("(") and "," in t2:
            comma_i = t2.find(",")
            rest = t2[comma_i + 1:].lstrip()
            if rest.startswith(")"):
                return t2
            return "(" + rest
        return t

    def _numeric_ensure(self, item_key: str) -> int:
        raw = self._store_path.read_text(encoding="utf-8")
        st = json.loads(str(raw or "{}"))

        numeric_map = st.get("numeric_map") or {}
        numeric_next = int(st.get("numeric_next") or 1)

        key = str(item_key or "")
        idx = self._bib_index_existing(key)
        if idx is None:
            idx = numeric_map.get(key)
            if idx is None:
                idx = max(self._bib_next_index(), numeric_next)

        numeric_map[key] = int(idx)
        numeric_next = max(int(numeric_next), int(idx) + 1)

        st["numeric_map"] = numeric_map
        st["numeric_next"] = int(numeric_next)
        self._store_path.write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")

        return int(idx)

    def _persist_numeric_state(self) -> None:
        raw = self._store_path.read_text(encoding="utf-8")
        st = json.loads(str(raw or "{}"))
        self._store_path.write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")

    def _numeric_biblio_entry(self, pl: dict, *, item_key: str, n: int) -> str:
        author = self._author_summary_clean(str(pl.get("author_summary") or pl.get("first_author_last") or ""))

        year = str(pl.get("year") or "").strip()
        title = str(pl.get("title") or "").strip()
        source = str(pl.get("source") or "").strip()
        url = str(pl.get("url") or "").strip()

        y = year if year else "n.d."
        t = title + ("." if (title and not title.endswith(".")) else "")
        s = source + ("." if (source and not source.endswith(".")) else "")

        line = ""
        if author:
            line += author + " "
        line += "(" + y + "). " + t + " " + s
        if url:
            line += " " + url
        return line.strip()

    def _build_numeric_refs_html(self, items: list[dict]) -> str:
        lines: list[tuple[int, str, str]] = []
        seen: dict[str, int] = {}

        i = 0
        while i < len(items):
            it = items[i]
            item_key = str(it["item_key"]).strip()
            if item_key == "":
                raise KeyError("item_key")

            if item_key not in seen:
                seen[item_key] = 1
                pl = self._records_map[item_key]
                n = self._numeric_ensure(item_key)
                lines.append((int(n), item_key, self._numeric_biblio_entry(pl, item_key=item_key, n=int(n))))
            i += 1

        lines.sort(key=lambda x: x[0])

        css = (
            "<style>"
            "  .csl-bib-body{"
            "    margin:0;"
            "    padding:0;"
            "  }"
            "  .csl-entry{"
            "    margin:0 0 0.8em 0;"
            "    padding-left:2em;"
            "    text-indent:-2em;"
            "    line-height:1.4;"
            "  }"
            "  .csl-entry:last-child{"
            "    margin-bottom:0;"
            "  }"
            "  .csl-number{"
            "    display:inline-block;"
            "    width:2em;"
            "  }"
            "</style>"
        )

        html = css + "<div class='csl-bib-body'>"
        j = 0
        while j < len(lines):
            n2, item_key2, txt = lines[j]
            html += (
                    "<div class='csl-entry' data-item-key='"
                    + self._esc(item_key2)
                    + "'><b class='csl-number'>["
                    + self._esc(str(n2))
                    + "]</b> "
                    + self._esc(txt)
                    + "</div>"
            )
            j += 1
        html += "</div>"
        return html

    def _build_apa_refs_html(self, items: list[dict]) -> str:
        rows: list[tuple[str, str, str]] = []
        seen: dict[str, int] = {}

        i = 0
        while i < len(items):
            it = items[i]
            item_key = str(it["item_key"]).strip()
            if item_key == "":
                raise KeyError("item_key")

            if item_key not in seen:
                seen[item_key] = 1

                pl = self._records_map[item_key]
                author_summary = self._author_summary_clean(
                    str(pl.get("author_summary") or pl.get("first_author_last") or "")
                )
                sortkey = self._apa_first_author_last(author_summary).lower()
                rows.append((sortkey, item_key, self._apa_biblio(pl)))

            i += 1

        rows.sort(key=lambda x: (x[0], x[1].lower()))

        css = (
            "<style>"
            "  .csl-bib-body{"
            "    margin:0;"
            "    padding:0;"
            "  }"
            "  .csl-entry{"
            "    margin:0 0 0.8em 0;"
            "    padding-left:2em;"
            "    text-indent:-2em;"
            "    line-height:1.4;"
            "  }"
            "  .csl-entry:last-child{"
            "    margin-bottom:0;"
            "  }"
            "</style>"
        )

        html = css + "<div class='csl-bib-body'>"
        j = 0
        while j < len(rows):
            _, item_key2, txt = rows[j]

            s = str(txt or "").strip()
            p = s.find("(")
            if p > 0:
                left = s[:p].strip()
                right = s[p:].lstrip()
                s2 = "<b>" + self._esc(left) + "</b> " + self._esc(right)
            else:
                s2 = self._esc(s)

            html += (
                    "<div class='csl-entry' data-item-key='"
                    + self._esc(item_key2)
                    + "'>"
                    + s2
                    + "</div>"
            )
            j += 1
        html += "</div>"
        return html

    def _apa_biblio(self, pl: dict) -> str:
        author_summary = str(pl.get("author_summary") or pl.get("first_author_last") or "").strip()
        year = str(pl.get("year") or "").strip()
        title = str(pl.get("title") or "").strip()
        source = str(pl.get("source") or "").strip()
        url = str(pl.get("url") or "").strip()

        y = year if year else "n.d."
        t = title + ("." if (title and not title.endswith(".")) else "")
        s = source + ("." if (source and not source.endswith(".")) else "")

        out = ""
        if author_summary:
            out += author_summary + " "
        out += "(" + y + "). " + t + " " + s
        if url:
            out += " " + url
        return out.strip()

    def _footnote_biblio_entry(self, pl: dict, page: str) -> str:
        base = self._apa_biblio(pl)
        p = str(page or "").strip()
        if not p:
            return base
        if not (p.lower().startswith("p.") or p.lower().startswith("pp.")):
            p = "p. " + p
        return (base + ", " + p).strip()

    def _build_body_with_footnotes_per_page(self, html: str, entry_map: dict[str, dict]) -> str:
        import re
        from bs4 import BeautifulSoup

        s = str(html or "")
        if not s.strip():
            return s

        token = "__ANNOTARIUM_PB__"
        s2 = re.sub(
            r"<img\b[^>]*class=['\"][^'\"]*mce-pagebreak[^'\"]*['\"][^>]*>",
            token,
            s,
            flags=re.IGNORECASE,
        )
        s2 = re.sub(r"<!--\s*pagebreak\s*-->", token, s2, flags=re.IGNORECASE)

        parts = s2.split(token)
        out_parts: list[str] = []

        for idx, part in enumerate(parts):
            soup = BeautifulSoup(part, "html.parser")

            for el in soup.select("div.annotarium-footnotes-block,ol[data-annotarium-footnotes],h2.footnotes-title"):
                el.decompose()

            anchors = soup.select("a.annotarium-cite[data-item-key],a.annotarium-cite[data-item-keys]")
            keys: list[str] = []
            seen: dict[str, int] = {}

            for a in anchors:
                g = str(a.get("data-item-keys") or "").strip()
                if g:
                    for part_k in g.split(";"):
                        k = part_k.strip()
                        if k and k not in seen:
                            seen[k] = 1
                            keys.append(k)
                else:
                    k = str(a.get("data-item-key") or "").strip()
                    if k and k not in seen:
                        seen[k] = 1
                        keys.append(k)

            if keys:
                wrap = soup.new_tag("div")
                wrap["class"] = "annotarium-footnotes-block"

                hr = soup.new_tag("hr")
                wrap.append(hr)

                ol = soup.new_tag("ol")
                ol["data-annotarium-footnotes"] = "1"
                ol["data-footnote-page"] = str(idx + 1)

                for k in keys:
                    pl = self._records_map.get(k) or {}
                    meta = entry_map.get(k) or {}
                    if "index" in meta:
                        try:
                            n = int(meta.get("index") or 0)
                        except Exception:
                            n = 0
                    else:
                        n = 0
                    if n <= 0:
                        n = int(self._numeric_ensure(k))
                    bib = self._footnote_biblio_entry(pl, str(meta.get("page") or ""))

                    li = soup.new_tag("li")
                    li["data-item-key"] = k
                    li["data-n"] = str(n)
                    li["value"] = str(n)
                    li.string = bib
                    ol.append(li)

                wrap.append(ol)
                soup.append(wrap)

            out_parts.append(str(soup))

        joined = token.join(out_parts)
        joined = joined.replace(token, "<img class=\"mce-pagebreak\" data-mce-type=\"pagebreak\" />")
        return joined


class TinyRefPanel(QWidget):
    """
    Embedded ref_picker.html. Use this only if you want the picker inside a panel.
    For the intended UX (plugin-like), use HtmlRefDialog instead.
    """

    def __init__(
        self,
        *,
        editor: MiniTinyMceEditor,
        direct_quote_lookup_json: str | Path,
        collection_name: str,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)

        self._editor = editor
        self._tiny_ref_html_path = Path(TINY_REF_HTML).resolve()
        self._db_path = Path(direct_quote_lookup_json).resolve()
        self._collection_name = str(collection_name or "").strip()
        self._store_path = _bib_store_path(self._collection_name)

        records = _load_or_build_records(direct_quote_lookup_json=self._db_path, collection_name=self._collection_name)

        self._view = QWebEngineView(self)
        self._profile = QWebEngineProfile("tiny_ref_panel_profile_" + self._collection_name, self)
        ps = self._profile.settings()
        ps.setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)
        ps.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
        ps.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)
        ps.setAttribute(QWebEngineSettings.WebAttribute.LocalStorageEnabled, True)

        self._page = QWebEnginePage(self._profile, self._view)
        self._view.setPage(self._page)

        s = self._view.settings()
        s.setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)
        s.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
        s.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)
        s.setAttribute(QWebEngineSettings.WebAttribute.LocalStorageEnabled, True)

        self._bridge = _TinyRefBridge(
            records=records,
            store_path=self._store_path,
            editor=self._editor,
            parent=self,
            collection_name=self._collection_name,
            close_fn=None,
            direct_quote_lookup_json=self._db_path,
        )
        self._channel = QWebChannel(self._page)
        self._channel.registerObject("pyBridge", self._bridge)
        self._page.setWebChannel(self._channel)

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        root.addWidget(self._view, 1)

        self._view.setUrl(QUrl.fromLocalFile(str(self._tiny_ref_html_path)))

    def run_js(self, js: str) -> None:
        self._page.runJavaScript(str(js or ""))

    @property
    def webview(self) -> QWebEngineView:
        return self._view

class HtmlRefDialog(QDialog):
    """
    Mini picker dialog (the intended UX): Ref opens this, user searches/selects/inserts, dialog can close.

    Preselection:
      - preselect_item_keys is supplied by the caller (typically _MiniTinyBridge.openRefPicker),
        which may have obtained the keys via openRefPickerWithPreselect(...) from JS.
      - This dialog does NOT query the editor for selection state (avoids callback signature mismatch).
    """

    def __init__(
        self,
        *,
        editor,
        direct_quote_lookup_json: str | Path,
        collection_name: str,
        parent: QWidget | None = None,
        title: str = "Tiny Ref",
        preselect_item_keys: list[str] | None = None,
    ):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.resize(1020, 720)

        self._editor = editor
        self._tiny_ref_html_path = Path(TINY_REF_HTML).resolve()
        self._db_path = Path(direct_quote_lookup_json).resolve()
        self._collection_name = str(collection_name or "").strip()
        self._store_path = _bib_store_path(self._collection_name)

        records = _load_or_build_records(
            direct_quote_lookup_json=self._db_path,
            collection_name=self._collection_name,
        )

        self._view = QWebEngineView(self)
        self._profile = QWebEngineProfile("tiny_ref_profile_" + self._collection_name, self)

        ps = self._profile.settings()
        ps.setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)
        ps.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
        ps.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)
        ps.setAttribute(QWebEngineSettings.WebAttribute.LocalStorageEnabled, True)

        self._page = QWebEnginePage(self._profile, self._view)
        self._view.setPage(self._page)

        s = self._view.settings()
        s.setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)
        s.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
        s.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)
        s.setAttribute(QWebEngineSettings.WebAttribute.LocalStorageEnabled, True)

        def _close_me():
            self.close()

        self._bridge = _TinyRefBridge(
            records=records,
            store_path=self._store_path,
            editor=self._editor,
            parent=self,
            collection_name=self._collection_name,
            close_fn=_close_me,
            direct_quote_lookup_json=self._db_path,
            preselect_item_keys=preselect_item_keys,
        )

        self._channel = QWebChannel(self._page)
        self._channel.registerObject("pyBridge", self._bridge)
        self._page.setWebChannel(self._channel)

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.addWidget(self._view, 1)

        self._view.setUrl(QUrl.fromLocalFile(str(self._tiny_ref_html_path)))


class TinyWithRefs(QWidget):
    """
    Main editor only.

    Ref/Biblio/Settings/Update live inside the HTML topbar (TINYMCE_HTML) and call
    the QWebChannel bridge methods on pyBridge.
    """

    def __init__(
            self,
            *,
            records: list[dict],
            store_path: Path,
            editor: MiniTinyMceEditor,
            parent: QObject,
            collection_name: str,
            direct_quote_lookup_json: Path,
            close_fn=None,
            preselect_item_keys: list[str] | None = None,
    ):
        super().__init__(parent)

        self._db = Path(direct_quote_lookup_json).resolve()
        self._collection_name = str(collection_name or "").strip()
        self._preselect_item_keys = preselect_item_keys

        self._editor = MiniTinyMceEditor(
            parent=self,
            direct_quote_lookup_json=self._db,
            collection_name=self._collection_name,
        )

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        root.addWidget(self._editor, 1)

    @property
    def editor(self) -> MiniTinyMceEditor:
        return self._editor


def demo_run() -> int:
    import sys
    from PyQt6.QtCore import Qt, QCoreApplication
    from PyQt6.QtWidgets import QApplication

    QCoreApplication.setAttribute(Qt.ApplicationAttribute.AA_UseSoftwareOpenGL)

    app = QApplication.instance()
    if app is None:
        app = QApplication(sys.argv)

    direct_quote_lookup_json = (
        r"C:\Users\luano\PycharmProjects\Back_end_assis\evidence_coding_outputs\0.13_cyber_attribution_corpus_records_total_included"
        r"\thematics_outputs\sections\1999-2009_2010-2018_2019-2025__rq=0,3,4,2,1\direct_quote_lookup.json"
    )

    w = TinyWithRefs(
        direct_quote_lookup_json=direct_quote_lookup_json,
        collection_name="0.13_cyber_attribution_corpus_records_total_included",
    )
    w.resize(1200, 820)
    w.show()

    return app.exec()


if __name__ == "__main__":
    raise SystemExit(demo_run())
