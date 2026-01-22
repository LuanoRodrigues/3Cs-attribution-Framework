#!/usr/bin/env python3
"""Screen host for the DataScreenerWidget, exposed to the Electron front end."""
import json
import os
import queue
import socketserver
import threading
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
import sys

from PyQt6.QtCore import QTimer
from PyQt6.QtWidgets import QApplication

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from bibliometric_analysis_tool.ui.data_screener_widget import DataScreenerWidget

SCREEN_HOST_PORT = int(os.environ.get("SCREEN_HOST_PORT", "8222"))

CommandPayload = Dict[str, Any]
CommandResponse = Dict[str, Any]
command_queue: queue.Queue[Tuple[CommandPayload, queue.Queue[CommandResponse]]] = queue.Queue()


_last_status_text: Optional[str] = None
_last_data_record: Optional[Tuple[int, Dict[str, Any]]] = None


class ScreenCommandHandler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        data = self.request.recv(4096).strip()
        if not data:
            return
        try:
            payload = json.loads(data.decode("utf-8"))
        except json.JSONDecodeError as exc:
            response = {"status": "error", "message": f"invalid_json:{exc}"}
            self.request.sendall(json.dumps(response).encode("utf-8"))
            return
        response_queue: queue.Queue[CommandResponse] = queue.Queue()
        command_queue.put((payload, response_queue))
        try:
            response = response_queue.get(timeout=5)
        except queue.Empty:
            response = {"status": "error", "message": "timeout"}
        self.request.sendall(json.dumps(response).encode("utf-8"))


class ScreenCommandServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class ScreenWidget(DataScreenerWidget):
    def closeEvent(self, event) -> None:
        event.ignore()
        self.hide()


def _navigate(widget: ScreenWidget, action: str) -> None:
    if action == "open":
        if not widget.isVisible():
            widget.show()
        widget.raise_()
        widget.activateWindow()
    elif action == "prev":
        widget.prev_record()
    elif action == "next":
        widget.next_record()


def _report_status(widget: ScreenWidget) -> CommandResponse:
    widget.update_nav_status()
    label = getattr(widget, "item_status_label", None)
    nav_text = label.text() if label is not None else "Status unavailable"
    return {"status": "ok", "nav": nav_text}


def _handle_payload(widget: ScreenWidget, payload: CommandPayload) -> CommandResponse:
    action = payload.get("action")
    if not action:
        return {"status": "error", "message": "action_missing"}
    if action == "status":
        return _report_status(widget)
    if action in {"open", "prev", "next"}:
        _navigate(widget, action)
        return _report_status(widget)
    if action == "close":
        widget.hide()
        return {"status": "ok", "message": "hidden"}
    return {"status": "error", "message": f"unsupported:{action}"}


def _poll_commands(widget: ScreenWidget) -> None:
    while not command_queue.empty():
        payload, response_queue = command_queue.get_nowait()
        response_queue.put(_handle_payload(widget, payload))


def _start_server() -> ScreenCommandServer:
    server = ScreenCommandServer(("127.0.0.1", SCREEN_HOST_PORT), ScreenCommandHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def main() -> None:
    app = QApplication([])
    app.setQuitOnLastWindowClosed(False)
    widget = ScreenWidget()
    widget.hide()
    server = _start_server()
    timer = QTimer()
    timer.setInterval(30)
    timer.timeout.connect(lambda: _poll_commands(widget))
    timer.start()
    print(f"SCREEN_HOST_READY port={SCREEN_HOST_PORT}")
    sys.stdout.flush()
    try:
        app.exec()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
