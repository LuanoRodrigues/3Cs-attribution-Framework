from PyQt6.QtCore import Qt, QPoint, QSize
from PyQt6.QtWidgets import (
    QHBoxLayout,
    QPushButton,
    QVBoxLayout,
    QComboBox, QSlider,
    QWidget,  QLabel,

)



class AudioSettingsWidget(QWidget):
    """
    ###1. Floating audio controls panel for TTS playback
    ###2. Can be anchored near a parent widget and then freely dragged
    ###3. Exposes slider, btn_play, btn_stop, cmb_voice, cmb_rate, cache menu, refs toggle, and timing helpers
    """

    def __init__(self, parent: QWidget | None = None) -> None:
        from PyQt6.QtWidgets import QToolButton, QMenu, QCheckBox

        super().__init__(parent)

        self.setObjectName("AudioSettingsWidget")
        self.setWindowFlags(
            Qt.WindowType.Tool
            | Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
        )
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating, True)

        self._drag_active = False
        self._drag_offset = QPoint()
        self._duration_ms = 0
        self._position_ms = 0
        self._display_rate = 1.0
        self._cache_handler = None
        self._refs_handler = None
        self._include_refs = True

        self._apply_modern_style()

        root = QVBoxLayout(self)
        root.setContentsMargins(10, 8, 10, 8)
        root.setSpacing(6)

        header_row = QHBoxLayout()
        header_row.setContentsMargins(0, 0, 0, 0)
        header_row.setSpacing(6)

        self.lbl_title = QLabel("Audio")
        self.lbl_title.setProperty("class", "Subtle")

        self.lbl_grip = QLabel("⠿")
        self.lbl_grip.setToolTip("Drag to move")
        self.lbl_grip.setAlignment(
            Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
        )
        self.lbl_grip.setCursor(Qt.CursorShape.SizeAllCursor)

        header_row.addWidget(self.lbl_title)
        header_row.addStretch(1)
        header_row.addWidget(self.lbl_grip)

        row1 = QHBoxLayout()
        row1.setContentsMargins(0, 0, 0, 0)
        row1.setSpacing(6)

        self.btn_play = QPushButton()
        self.btn_play.setObjectName("AudioPlay")
        self.btn_play.setFixedSize(32, 32)
        self.btn_play.setIconSize(QSize(18, 18))
        self.btn_play.setCursor(Qt.CursorShape.PointingHandCursor)

        self.btn_stop = QPushButton()
        self.btn_stop.setObjectName("AudioStop")
        self.btn_stop.setFixedSize(32, 32)
        self.btn_stop.setIconSize(QSize(18, 18))
        self.btn_stop.setCursor(Qt.CursorShape.PointingHandCursor)

        self.cmb_voice = QComboBox()
        self.cmb_voice.setMinimumWidth(120)
        self.cmb_voice.addItems(
            [
                "alloy",
                "ash",
                "ballad",
                "coral",
                "echo",
                "fable",
                "nova",
                "onyx",
                "sage",
                "shimmer",
                "verse",
            ]
        )
        self.cmb_voice.setCursor(Qt.CursorShape.PointingHandCursor)

        from PyQt6.QtWidgets import QWidgetAction

        self.cmb_rate = QComboBox()
        self.cmb_rate.setMinimumWidth(80)

        self._rate_min = 0.5
        self._rate_max = 2.5
        self._rate_step = 0.1

        self._rate_values: list[float] = []
        v_rate = self._rate_min
        while v_rate <= self._rate_max + 1e-9:
            self._rate_values.append(v_rate)
            label = f"{v_rate:.1f}x"
            self.cmb_rate.addItem(label)
            v_rate = v_rate + self._rate_step

        default_rate = 1.2
        default_idx = 0
        idx_rate = 0
        while idx_rate < len(self._rate_values):
            if abs(self._rate_values[idx_rate] - default_rate) < 1e-6:
                default_idx = idx_rate
                break
            idx_rate = idx_rate + 1

        self.cmb_rate.setCurrentIndex(default_idx)
        self.cmb_rate.setCursor(Qt.CursorShape.PointingHandCursor)
        self.cmb_rate.hide()

        self._rate_index = default_idx

        lbl_voice = QLabel("Voice")
        lbl_rate = QLabel("Speed")

        self.btn_cache = QToolButton()
        self.btn_cache.setText("Cache")
        self.btn_cache.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_cache.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextOnly)
        self.btn_cache.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)

        self.menu_cache = QMenu(self)
        self.act_cache_current = self.menu_cache.addAction("Audio: Page")
        self.act_cache_selected = self.menu_cache.addAction("Audio: Selected sections")
        self.act_cache_all = self.menu_cache.addAction("Audio: All sections")

        self.btn_cache.setMenu(self.menu_cache)

        self.act_cache_current.triggered.connect(lambda: self._on_cache_choice("page"))
        self.act_cache_selected.triggered.connect(lambda: self._on_cache_choice("selected"))
        self.act_cache_all.triggered.connect(lambda: self._on_cache_choice("all"))

        self.btn_rate = QToolButton()
        self.btn_rate.setObjectName("RateButton")
        self.btn_rate.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_rate.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextOnly)
        self.btn_rate.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
        self.btn_rate.setText(f"{self._rate_values[self._rate_index]:.1f}x")

        self.menu_rate = QMenu(self)
        self.menu_rate.setObjectName("RateMenu")

        rate_panel = QWidget(self.menu_rate)
        rate_panel_layout = QVBoxLayout(rate_panel)
        rate_panel_layout.setContentsMargins(10, 8, 10, 10)
        rate_panel_layout.setSpacing(6)

        rate_header = QHBoxLayout()
        rate_header.setContentsMargins(0, 0, 0, 0)
        rate_header.setSpacing(4)

        lbl_speed_title = QLabel("Speed")
        lbl_speed_title.setProperty("class", "Subtle")
        self._lbl_rate_value = QLabel(f"{self._rate_values[self._rate_index]:.1f}x")

        rate_header.addWidget(lbl_speed_title)
        rate_header.addStretch(1)
        rate_header.addWidget(self._lbl_rate_value)

        rate_panel_layout.addLayout(rate_header)

        slider_row = QHBoxLayout()
        slider_row.setContentsMargins(0, 0, 0, 0)
        slider_row.setSpacing(0)

        slider_col = QVBoxLayout()
        slider_col.setContentsMargins(0, 4, 0, 4)
        slider_col.setSpacing(0)

        self._rate_slider = QSlider(Qt.Orientation.Vertical)
        self._rate_slider.setObjectName("RateSlider")
        self._rate_slider.setRange(0, len(self._rate_values) - 1)
        self._rate_slider.setValue(self._rate_index)
        self._rate_slider.setSingleStep(1)
        self._rate_slider.setPageStep(1)
        self._rate_slider.setTickPosition(QSlider.TickPosition.NoTicks)
        self._rate_slider.setCursor(Qt.CursorShape.PointingHandCursor)
        self._rate_slider.setFixedWidth(28)
        self._rate_slider.setMinimumHeight(160)

        slider_col.addWidget(
            self._rate_slider, 1, alignment=Qt.AlignmentFlag.AlignHCenter
        )
        slider_row.addLayout(slider_col, 1)

        rate_panel_layout.addLayout(slider_row)

        def _set_rate_index(idx: int) -> None:
            if idx < 0:
                idx = 0
            if idx >= len(self._rate_values):
                idx = len(self._rate_values) - 1
            self._rate_index = idx
            rate_val = self._rate_values[idx]
            label = f"{rate_val:.1f}x"

            self.cmb_rate.setCurrentIndex(idx)
            self.btn_rate.setText(label)
            self._lbl_rate_value.setText(label)

            self._rate_slider.blockSignals(True)
            self._rate_slider.setValue(idx)
            self._rate_slider.blockSignals(False)

        self._rate_slider.valueChanged.connect(lambda v: _set_rate_index(int(v)))

        rate_action = QWidgetAction(self.menu_rate)
        rate_action.setDefaultWidget(rate_panel)
        self.menu_rate.addAction(rate_action)
        self.btn_rate.setMenu(self.menu_rate)

        self.chk_refs = QCheckBox("Refs")
        self.chk_refs.setChecked(False)
        self.chk_refs.setCursor(Qt.CursorShape.PointingHandCursor)
        self.chk_refs.stateChanged.connect(self._on_refs_toggled)

        row1.addWidget(self.btn_play)
        row1.addWidget(self.btn_stop)
        row1.addWidget(self.btn_cache)
        row1.addSpacing(10)
        row1.addWidget(lbl_voice)
        row1.addWidget(self.cmb_voice)
        row1.addWidget(self.chk_refs)
        row1.addSpacing(6)
        row1.addWidget(lbl_rate)
        row1.addWidget(self.btn_rate)

        row2 = QVBoxLayout()
        row2.setContentsMargins(0, 0, 0, 0)
        row2.setSpacing(2)

        self.slider = QSlider(Qt.Orientation.Horizontal)
        self.slider.setRange(0, 0)
        self.slider.setCursor(Qt.CursorShape.PointingHandCursor)

        time_row = QHBoxLayout()
        time_row.setContentsMargins(0, 0, 0, 0)
        time_row.setSpacing(4)

        self.lbl_pos = QLabel("0:00")
        self.lbl_pos.setProperty("class", "Subtle")
        self.lbl_dur = QLabel("/ 0:00")
        self.lbl_dur.setProperty("class", "Subtle")

        time_row.addWidget(self.lbl_pos)
        time_row.addWidget(self.lbl_dur)
        time_row.addStretch(1)

        row2.addWidget(self.slider)
        row2.addLayout(time_row)

        root.addLayout(header_row)
        root.addLayout(row1)
        root.addLayout(row2)

        self.setMinimumWidth(460)

        self._init_button_icons()
        self.slider.sliderMoved.connect(self._on_slider_moved)

    def _apply_modern_style(self) -> None:
        self.setStyleSheet(
            """
            #AudioSettingsWidget {
                background: qlineargradient(
                    x1:0, y1:0, x2:0, y2:1,
                    stop:0 #0F1420,
                    stop:1 #0C1220
                );
                border-radius: 14px;
                border: 1px solid #1B2233;
            }

            #AudioSettingsWidget QLabel {
                color: #E7ECF3;
                font-size: 12px;
            }

            #AudioSettingsWidget QLabel[class="Subtle"] {
                color: #AEB7C4;
            }

            #AudioSettingsWidget QPushButton,
            #AudioSettingsWidget QToolButton {
                background: rgba(255,255,255,0.03);
                color: #E7ECF3;
                border-radius: 999px;
                border: 1px solid #1B2233;
                padding: 6px 12px;
            }

            #AudioSettingsWidget QPushButton:hover,
            #AudioSettingsWidget QToolButton:hover {
                background: rgba(255,255,255,0.06);
                border-color: rgba(125,211,252,0.45);
            }

            #AudioSettingsWidget QPushButton:pressed,
            #AudioSettingsWidget QToolButton:pressed {
                background: rgba(255,255,255,0.10);
                border-color: rgba(125,211,252,0.70);
            }

            #AudioSettingsWidget QPushButton#AudioPlay {
                min-width: 0px;
                padding: 0px;
                font-size: 16px;
                font-weight: 600;
                color: rgba(248,250,252,0.96);
                border-radius: 18px;
                border: none;
                background: qlineargradient(
                    x1:0, y1:0, x2:1, y2:0,
                    stop:0 #67C4EA,
                    stop:1 #3B82F6
                );
                box-shadow: 0 0 6px rgba(59,130,246,0.25);
                transition: background 140ms ease, box-shadow 140ms ease;
            }

            #AudioSettingsWidget QPushButton#AudioPlay:hover {
                background: qlineargradient(
                    x1:0, y1:0, x2:1, y2:0,
                    stop:0 #BAF3FF,
                    stop:1 #8EDCFF
                );
                box-shadow: 0 0 15px rgba(125,211,252,0.38);
            }

            #AudioSettingsWidget QPushButton#AudioPlay:pressed {
                background: qlineargradient(
                    x1:0, y1:0, x2:1, y2:0,
                    stop:0 #60BDFE,
                    stop:1 #3F8DF5
                );
                box-shadow: 0 0 10px rgba(125,211,252,0.50) inset;
            }

            #AudioSettingsWidget QPushButton#AudioStop {
                min-width: 0px;
                padding: 0px;
                font-size: 16px;
                font-weight: 600;
                border-radius: 16px;
                background: rgba(255,90,90,0.14);
                border: 1px solid rgba(255,120,120,0.55);
                color: rgba(255,190,190,0.92);
                box-shadow: 0 0 10px rgba(255,80,80,0.20);
                transition: background 160ms ease, box-shadow 160ms ease;
            }

            #AudioSettingsWidget QPushButton#AudioStop:hover {
                background: rgba(255,100,100,0.22);
                box-shadow: 0 0 13px rgba(255,120,120,0.30);
            }

            #AudioSettingsWidget QPushButton#AudioStop:pressed {
                background: rgba(255,90,90,0.28);
                box-shadow: 0 0 8px rgba(255,120,120,0.38) inset;
            }

            #AudioSettingsWidget QComboBox {
                background: rgba(255,255,255,0.02);
                color: #E7ECF3;
                border-radius: 12px;
                border: 1px solid #1B2233;
                padding: 6px 12px;
            }

            #AudioSettingsWidget QComboBox:hover {
                border-color: rgba(125,211,252,0.65);
            }

            #AudioSettingsWidget QComboBox::drop-down {
                width: 18px;
                border: none;
            }

            #AudioSettingsWidget QComboBox QAbstractItemView {
                background: #0C1220;
                color: #E7ECF3;
                border: 1px solid #1B2233;
                selection-background-color: #1F2933;
                selection-color: #E7ECF3;
            }

            #AudioSettingsWidget QSlider::groove:horizontal {
                border: 1px solid #1B2233;
                height: 6px;
                background: rgba(255,255,255,0.03);
                border-radius: 3px;
            }

            #AudioSettingsWidget QSlider::handle:horizontal {
                background: #7DD3FC;
                border: 1px solid #60A5FA;
                width: 14px;
                margin: -4px 0;
                border-radius: 7px;
            }

            #AudioSettingsWidget QSlider::handle:horizontal:hover {
                background: #BAE6FD;
            }

            #AudioSettingsWidget QSlider::sub-page:horizontal {
                background: qlineargradient(
                    x1:0, y1:0, x2:1, y2:0,
                    stop:0 #60A5FA,
                    stop:1 #22C55E
                );
                border-radius: 3px;
            }

            #AudioSettingsWidget QSlider::add-page:horizontal {
                background: transparent;
            }

            #AudioSettingsWidget QToolButton#RateButton {
                padding: 4px 10px;
                border-radius: 999px;
                background: rgba(15,23,42,0.85);
                border: 1px solid rgba(148,163,184,0.55);
                font-size: 12px;
            }

            #AudioSettingsWidget QToolButton#RateButton:hover {
                background: rgba(30,64,175,0.90);
                border-color: #6366F1;
            }

            #AudioSettingsWidget QToolButton#RateButton::menu-indicator {
                image: none;
                width: 0px;
            }

            QMenu#RateMenu {
                background-color: #020617;
                border-radius: 16px;
                border: 1px solid rgba(148,163,184,0.45);
                padding: 0px;
                margin: 0px;
            }

            QMenu#RateMenu QWidget {
                background-color: transparent;
            }

            QMenu#RateMenu QLabel {
                color: #E5E7EB;
                font-size: 11px;
            }

            #AudioSettingsWidget QSlider#RateSlider::groove:vertical {
                border: none;
                width: 6px;
                background: rgba(30,64,175,0.30);
                border-radius: 3px;
                margin: 4px 0;
            }

            #AudioSettingsWidget QSlider#RateSlider::handle:vertical {
                background: #3B82F6;
                border: 1px solid #60A5FA;
                height: 14px;
                margin: 0 -4px;
                border-radius: 7px;
            }

            #AudioSettingsWidget QSlider#RateSlider::handle:vertical:hover {
                background: #60A5FA;
            }

            #AudioSettingsWidget QSlider#RateSlider::sub-page:vertical {
                background: qlineargradient(
                    x1:0, y1:1, x2:0, y2:0,
                    stop:0 #1D4ED8,
                    stop:1 #38BDF8
                );
                border-radius: 3px;
            }

            #AudioSettingsWidget QSlider#RateSlider::add-page:vertical {
                background: transparent;
            }
            """
        )

    def _init_button_icons(self) -> None:
        from PyQt6.QtWidgets import QStyle

        style = self.style()
        play_icon = style.standardIcon(QStyle.StandardPixmap.SP_MediaPlay)
        stop_icon = style.standardIcon(QStyle.StandardPixmap.SP_MediaStop)

        self.btn_play.setText("")
        self.btn_stop.setText("")

        self.btn_play.setIcon(play_icon)
        self.btn_stop.setIcon(stop_icon)

        self.btn_play.setToolTip("Play")
        self.btn_stop.setToolTip("Stop")

    def set_play_state(self, is_playing: bool) -> None:
        from PyQt6.QtWidgets import QStyle

        style = self.style()
        self.btn_play.setText("")

        if is_playing:
            icon = style.standardIcon(QStyle.StandardPixmap.SP_MediaPause)
            self.btn_play.setIcon(icon)
            self.btn_play.setToolTip("Pause")
        else:
            icon = style.standardIcon(QStyle.StandardPixmap.SP_MediaPlay)
            self.btn_play.setIcon(icon)
            self.btn_play.setToolTip("Play")

    def _format_ms(self, ms: int) -> str:
        if ms < 0:
            ms = 0
        total_sec = int(ms / 1000)
        minutes = int(total_sec // 60)
        seconds = int(total_sec % 60)
        if seconds < 10:
            return f"{minutes}:0{seconds}"
        return f"{minutes}:{seconds}"

    def _effective_ms(self, raw_ms: int) -> int:
        if raw_ms < 0:
            raw_ms = 0
        rate = self._display_rate
        if not isinstance(rate, (int, float)):
            rate = 1.0
        if rate <= 0.0:
            rate = 1.0
        return int(raw_ms / rate)

    def set_display_rate(self, rate: float) -> None:
        if not isinstance(rate, (int, float)):
            rate = 1.0
        if rate <= 0.0:
            rate = 1.0
        self._display_rate = float(rate)

        effective_dur = self._effective_ms(self._duration_ms)
        effective_pos = self._effective_ms(self._position_ms)

        self.lbl_dur.setText("/ " + self._format_ms(effective_dur))
        self.lbl_pos.setText(self._format_ms(effective_pos))

    def set_duration_ms(self, dur_ms: int) -> None:
        if dur_ms < 0:
            dur_ms = 0
        self._duration_ms = int(dur_ms)
        self.slider.setRange(0, self._duration_ms)

        effective_dur = self._effective_ms(self._duration_ms)
        self.lbl_dur.setText("/ " + self._format_ms(effective_dur))

    def set_position_ms(self, pos_ms: int) -> None:
        if pos_ms < 0:
            pos_ms = 0
        if self._duration_ms > 0 and pos_ms > self._duration_ms:
            pos_ms = self._duration_ms

        self._position_ms = int(pos_ms)

        self.slider.blockSignals(True)
        self.slider.setValue(self._position_ms)
        self.slider.blockSignals(False)

        effective_pos = self._effective_ms(self._position_ms)
        self.lbl_pos.setText(self._format_ms(effective_pos))

    def reset(self) -> None:
        self._duration_ms = 0
        self._position_ms = 0

        self.slider.blockSignals(True)
        self.slider.setRange(0, 0)
        self.slider.setValue(0)
        self.slider.blockSignals(False)

        self.lbl_pos.setText("0:00")
        self.lbl_dur.setText("/ 0:00")
        self.set_play_state(False)

    def show_for_anchor(self, anchor: QWidget | None) -> None:
        if anchor is not None:
            anchor_geom = anchor.geometry()
            top_left = anchor.mapToGlobal(anchor_geom.topLeft())
            self.adjustSize()
            w = self.width()
            h = self.height()
            x = top_left.x() + (anchor_geom.width() - w) // 2
            y = top_left.y() + anchor_geom.height() - h - 16
            if y < 0:
                y = 0
            self.move(x, y)
        self.show()
        self.raise_()

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_active = True
            global_pos = event.globalPosition().toPoint()
            self._drag_offset = global_pos - self.frameGeometry().topLeft()
            event.accept()
            return
        QWidget.mousePressEvent(self, event)

    def mouseMoveEvent(self, event) -> None:
        if self._drag_active and event.buttons() & Qt.MouseButton.LeftButton:
            global_pos = event.globalPosition().toPoint()
            new_pos = global_pos - self._drag_offset
            self.move(new_pos)
            event.accept()
            return
        QWidget.mouseMoveEvent(self, event)

    def mouseReleaseEvent(self, event) -> None:
        if event.button() == Qt.MouseButton.LeftButton and self._drag_active:
            self._drag_active = False
            event.accept()
            return
        QWidget.mouseReleaseEvent(self, event)

    def _on_slider_moved(self, value: int) -> None:
        raw_ms = int(value)
        if raw_ms < 0:
            raw_ms = 0
        effective_pos = self._effective_ms(raw_ms)
        self.lbl_pos.setText(self._format_ms(effective_pos))

    def set_cache_handler(self, handler) -> None:
        """
        ###1. Store callback invoked for cache menu choices
        ###2. Callback receives a scope string: 'current', 'selected', or 'all'
        """
        self._cache_handler = handler

    def _on_cache_choice(self, scope: str) -> None:
        handler = getattr(self, "_cache_handler", None)
        if handler is None:
            print("[AudioSettingsWidget] cache handler not set for scope", scope)
            return
        handler(scope)

    def set_refs_handler(self, handler) -> None:
        """
        ###1. Store callback invoked when refs toggle changes
        ###2. Callback receives a bool include_refs
        """
        self._refs_handler = handler

    def _on_refs_toggled(self, state: int) -> None:
        self._include_refs = self.chk_refs.isChecked()
        handler = getattr(self, "_refs_handler", None)
        if handler is not None:
            handler(bool(self._include_refs))

    def include_refs(self) -> bool:
        """
        ###1. Return current refs toggle state
        """
        return bool(self.chk_refs.isChecked())

    def update_cache_counts(self, counts: dict) -> None:
        """
        ###1. Update cache menu labels with cached/total counts per scope
        ###2. Disable actions whose total is zero
        """

        def _pair_for(key: str) -> tuple[int, int]:
            pair = counts.get(key) if isinstance(counts, dict) else None
            if isinstance(pair, tuple) and len(pair) == 2:
                cached, total = pair
            else:
                cached = 0
                total = 0
            if not isinstance(cached, int):
                cached = 0
            if not isinstance(total, int):
                total = 0
            if cached < 0:
                cached = 0
            if total < 0:
                total = 0
            if cached > total:
                cached = total
            return cached, total

        cur_cached, cur_total = _pair_for("current")
        sel_cached, sel_total = _pair_for("selected")
        all_cached, all_total = _pair_for("all")

        self.act_cache_current.setText(
            "Audio: Current section (" + str(cur_cached) + "/" + str(cur_total) + ")"
        )
        self.act_cache_current.setEnabled(cur_total > 0)

        self.act_cache_selected.setText(
            "Audio: Selected sections (" + str(sel_cached) + "/" + str(sel_total) + ")"
        )
        self.act_cache_selected.setEnabled(sel_total > 0)

        self.act_cache_all.setText(
            "Audio: All sections (" + str(all_cached) + "/" + str(all_total) + ")"
        )
        self.act_cache_all.setEnabled(all_total > 0)
