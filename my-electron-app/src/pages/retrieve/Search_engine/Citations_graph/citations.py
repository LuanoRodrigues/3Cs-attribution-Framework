# citations.py

import os
import sys
import json
from pathlib import Path

# ------------------------------------------------------------------
# WebEngine stability bootstrap (MUST run before any PyQt6 import)
# ------------------------------------------------------------------
is_windows = sys.platform.startswith("win")


def _clean_flags(s: str) -> str:
    s = (s or "").strip()
    return " ".join(s.split())


def _flagset(s: str) -> set[str]:
    return set((s or "").split())


def _add_flags(s: str, add: list[str]) -> str:
    parts = (s or "").split()
    have = set(parts)
    for f in add:
        if f not in have:
            parts.append(f)
    return " ".join(parts).strip()


def _remove_flags(s: str, remove: list[str]) -> str:
    rm = set(remove or [])
    parts = [p for p in (s or "").split() if p not in rm]
    return " ".join(parts).strip()


force_software = (os.environ.get("CITATIONS_FORCE_SOFTWARE_GL") or "").strip().lower() in ("1", "true", "yes")
chromium_flags = _clean_flags(os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS") or "")

if force_software:
    chromium_flags = _remove_flags(
        chromium_flags,
        ["--disable-gpu", "--use-gl=swiftshader", "--use-gl=desktop", "--use-gl=egl", "--use-gl=angle", "--use-angle=swiftshader"],
    )
    chromium_flags = _add_flags(chromium_flags, ["--use-gl=angle", "--use-angle=swiftshader", "--disable-gpu-compositing"])
else:
    chromium_flags = _add_flags(chromium_flags, ["--disable-gpu", "--disable-gpu-compositing"])

os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = chromium_flags

flags = os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS", "")
if "--use-gl=swiftshader" in _flagset(flags):
    raise RuntimeError("Unsupported on this Windows WebEngine build. Use: --use-gl=angle --use-angle=swiftshader")

if not is_windows:
    os.environ.setdefault("QTWEBENGINE_DISABLE_SANDBOX", "1")

# ------------------------------------------------------------------
# PyQt6 imports (after bootstrap)
# ------------------------------------------------------------------
from PyQt6.QtCore import QUrl, QTimer, pyqtSlot, QObject
from PyQt6.QtGui import QIcon
from PyQt6.QtWidgets import QApplication, QDialog, QMessageBox, QVBoxLayout
from PyQt6.QtWebChannel import QWebChannel
from PyQt6.QtWebEngineCore import QWebEnginePage
from PyQt6.QtWebEngineWidgets import QWebEngineView


def _resources_dir() -> Path:
    return Path(__file__).resolve().parent / "ressources"


def _html_path() -> Path:
    return _resources_dir() / "citations.html"


def _as_payload(structured_references: dict) -> dict:
    if isinstance(structured_references, dict) and "structured_references" in structured_references:
        sr = structured_references.get("structured_references") or {}
        refs = sr.get("references") or []
        return {"structured_references": {"references": refs if isinstance(refs, list) else []}}

    if isinstance(structured_references, dict) and "references" in structured_references:
        refs = structured_references.get("references") or []
        return {"structured_references": {"references": refs if isinstance(refs, list) else []}}

    return {"structured_references": {"references": []}}


class WebEnginePage(QWebEnginePage):
    @pyqtSlot(int, str, int, str)
    def _emit_console(self, level: int, message: str, line_number: int, source_id: str) -> None:
        print(f"[JS:{int(level)}] {source_id}:{int(line_number)} {message}", flush=True)

    def javaScriptConsoleMessage(self, level, message, line_number, source_id):
        lvl = 0
        if isinstance(level, int):
            lvl = level
        elif hasattr(level, "value"):
            lvl = int(level.value)
        else:
            lvl = 0

        self._emit_console(lvl, str(message), int(line_number), str(source_id))
        super().javaScriptConsoleMessage(level, message, line_number, source_id)


class _Bridge(QObject):
    @pyqtSlot(str)
    def log(self, msg: str) -> None:
        print(str(msg), flush=True)

    @pyqtSlot()
    def uiReady(self) -> None:
        print("[BRIDGE] uiReady", flush=True)


class CitationsGraphDialog(QDialog):
    def __init__(self, structured_references: dict, parent=None):
        """
        ###1. load citations.html from ressources/ in a QWebEngineView
        ###2. establish QWebChannel bridge (BRIDGE)
        ###3. inject references once loadFinished fires
        """
        super().__init__(parent)

        self.setWindowTitle("Citations Graph")
        self.resize(1180, 760)

        self._payload = _as_payload(structured_references)
        self._page_loaded = False
        self._injected = False

        self.web = QWebEngineView(self)
        page = WebEnginePage(self.web)
        self.web.setPage(page)

        self._channel = QWebChannel(self.web.page())
        self._bridge = _Bridge()
        self._channel.registerObject("BRIDGE", self._bridge)
        self.web.page().setWebChannel(self._channel)

        root = QVBoxLayout()
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        root.addWidget(self.web, 1)
        self.setLayout(root)

        hp = _html_path()
        if not hp.exists():
            QMessageBox.critical(self, "Missing UI file", f"Missing:\n{hp}")
            return

        self.web.loadFinished.connect(self._on_loaded_html)
        self.web.setUrl(QUrl.fromLocalFile(str(hp)))

    def _on_loaded_html(self, ok: bool) -> None:
        self._page_loaded = bool(ok)
        if not self._page_loaded:
            print("[CITATIONS] loadFinished: false", flush=True)
            return

        QTimer.singleShot(0, self._inject_payload)

    def _inject_payload(self) -> None:
        if self._injected:
            return
        if not self._page_loaded:
            return

        js_payload = json.dumps(self._payload, ensure_ascii=False)
        js = "window.setReferences(" + js_payload + ");"
        self.web.page().runJavaScript(js)
        self._injected = True

    def set_references(self, structured_references: dict) -> None:
        self._payload = _as_payload(structured_references)
        self._injected = False
        QTimer.singleShot(0, self._inject_payload)


def run_citations_widget(structured_references: dict) -> None:
    """
    ###1. create QApplication and show CitationsGraphDialog
    ###2. pass structured references payload to the UI
    """
    app = QApplication.instance()
    if app is None:
        app = QApplication(sys.argv)

    icon_path = Path(__file__).resolve().parent / "app_icon.png"
    if icon_path.exists():
        app.setWindowIcon(QIcon(str(icon_path)))

    dlg = CitationsGraphDialog(structured_references)
    dlg.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    demo = {
        "structured_references": {
            "references": [
                {
                    "mention_id": "m1",
                    "citation_type": "in_text",
                    "citation_anchor": "19",
                    "context_preceding": "According to Minister Ahmad, the WannaCry incident impacted 300,000 computers in 150 countries including 48",
                    "raw": "19",
                    "footnote_number": 19,
                },
                {
                    "mention_id": "m2",
                    "citation_type": "in_text",
                    "citation_anchor": "7",
                    "context_preceding": "Although he noted that it was highly likely that ‘North Korean actors’ had orchestrated the ransomware campaign, his statement stopped short of",
                    "raw": "7",
                    "footnote_number": 7,
                },
                {
                    "mention_id": "m3",
                    "citation_type": "footnote",
                    "citation_anchor": "41",
                    "context_preceding": "2. Due to the multiple layers of aliases and proxies, the evidence on the use of various IP",
                    "raw": "41 See, eg, ibid, paras 189–90 (Poland), 225 (United Kingdom).",
                    "footnote_number": 41,
                },
            ]
        }
    }

    run_citations_widget(demo)
