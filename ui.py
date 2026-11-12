import os
import webbrowser
from PyQt5.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QScrollArea, QPushButton, QLabel,
    QDialog, QLineEdit, QSlider, QMessageBox
)
from PyQt5.QtCore import Qt, QRect, QUrl
from PyQt5.QtGui import QPixmap, QPainter, QColor, QFont, QPen, QDesktopServices

from .config import DEFAULT_CONFIG, BASE_DIR, find_editor_html

def open_html_in_browser(path, parent=None):
    if not path or not os.path.exists(path):
        QMessageBox.warning(parent, "Ошибка", f"Файл не найден:\n{path}")
        return False
    try:
        if QDesktopServices.openUrl(QUrl.fromLocalFile(path)): return True
    except: pass
    try:
        webbrowser.open(f"file:///{path.replace(os.sep, '/')}")
        return True
    except: return False

def open_editor(parent=None):
    return open_html_in_browser(find_editor_html(), parent)

class CollapsibleBox(QWidget):
    def __init__(self, title="", parent=None):
        super().__init__(parent)
        self._title = title
        self.toggle_button = QPushButton("▶ " + title)
        self.toggle_button.setCheckable(True)
        self.toggle_button.setChecked(False)
        self.toggle_button.setStyleSheet("""
            QPushButton { text-align:left; padding:6px; border:1px solid #2a3242;
                border-radius:6px; background:#182031; color:#e6eaf3; font-weight:bold; }
            QPushButton:hover { background:#212b40; }
        """)
        self.toggle_button.toggled.connect(self.on_toggled)
        self.content_area = QScrollArea()
        self.content_area.setStyleSheet("QScrollArea{border:none;background:transparent;}")
        self.content_area.setWidgetResizable(True)
        self.content_area.setVisible(False)
        self.content_area.setMinimumHeight(150)
        lay = QVBoxLayout(self)
        lay.addWidget(self.toggle_button)
        lay.addWidget(self.content_area)
        lay.setContentsMargins(0, 0, 0, 0)

    def on_toggled(self, checked):
        self.content_area.setVisible(checked)
        self.toggle_button.setText(("▼ " if checked else "▶ ") + self._title)

    def setContentLayout(self, layout):
        self.content_area.setLayout(layout)

class SliderRow(QWidget):
    def __init__(self, label_text, min_val, max_val, current_val, divisor=1.0, suffix=""):
        super().__init__()
        h = QHBoxLayout(self)
        h.setContentsMargins(0, 0, 0, 0)
        self.lbl = QLabel(label_text)
        self.lbl.setMinimumWidth(140)
        self.val_lbl = QLabel()
        self.val_lbl.setStyleSheet("color:#e6eaf3;font-weight:bold;min-width:70px;")
        self.val_lbl.setAlignment(Qt.AlignRight)
        self.slider = QSlider(Qt.Horizontal)
        self.slider.setRange(min_val, max_val)
        self.slider.setValue(current_val)
        self.divisor = divisor
        self.suffix = suffix
        self.slider.valueChanged.connect(self._on_change)
        self._on_change(current_val)
        h.addWidget(self.lbl, 1)
        h.addWidget(self.slider, 3)
        h.addWidget(self.val_lbl)

    def _on_change(self, v):
        val = v / self.divisor if self.divisor != 1.0 else v
        if isinstance(val, float):
            self.val_lbl.setText(f"{val:.2f}{self.suffix}")
        else:
            self.val_lbl.setText(f"{val}{self.suffix}")

class MemRow(QWidget):
    def __init__(self, label_text, min_val, max_val, current_val):
        super().__init__()
        h = QHBoxLayout(self)
        h.setContentsMargins(0, 0, 0, 0)
        self.lbl = QLabel(label_text)
        self.lbl.setMinimumWidth(140)

        self.help_icon = QLabel("💡")
        self.help_icon.setToolTip("РЕКОМЕНДУЕТСЯ 250-300 МБ\nПри достижении 80% от лимита программа принудительно очистит память.")
        self.help_icon.setStyleSheet("color: #2fd39a; font-weight: bold; cursor: help; padding-left: 4px;")

        self.val_lbl = QLabel()
        self.val_lbl.setStyleSheet("color:#e6eaf3;font-weight:bold;min-width:70px;")
        self.val_lbl.setAlignment(Qt.AlignRight)

        self.slider = QSlider(Qt.Horizontal)
        self.slider.setRange(min_val, max_val)
        self.slider.setValue(current_val)
        self.slider.valueChanged.connect(self._on_change)
        self._on_change(current_val)

        h.addWidget(self.lbl, 1)
        h.addWidget(self.help_icon)
        h.addWidget(self.slider, 3)
        h.addWidget(self.val_lbl)

    def _on_change(self, v):
        self.val_lbl.setText(f"{v} МБ")

class SettingsDialog(QDialog):
    def __init__(self, config, parent=None, on_save=None):
        super().__init__(parent)
        self.setWindowFlags(self.windowFlags() | Qt.WindowStaysOnTopHint)
        self.on_save = on_save
        self.setWindowTitle("Настройки HeadVoice")
        self.setMinimumWidth(520)
        self.setMinimumHeight(650)
        self.config = dict(config)

        self.setStyleSheet("""
            QDialog{background:#141926;color:#e6eaf3;}
            QLabel{color:#7f8ba3;font-size:13px;}
            QSlider::groove:horizontal{height:6px;background:#2a3242;border-radius:3px;}
            QSlider::handle:horizontal{background:#2fd39a;width:16px;margin:-5px 0;border-radius:8px;}
            QSlider::sub-page:horizontal{background:#2fd39a;border-radius:3px;}
            QPushButton{background:#182031;color:#dbe3f2;border:1px solid #2a3242;
                border-radius:10px;padding:8px 14px;}
            QPushButton:hover{background:#212b40;border-color:#3a465f;}
            QPushButton#primary{background:#33dba1;color:#04120c;font-weight:bold;}
            QLineEdit{background:#182031;color:#e6eaf3;border:1px solid #2a3242;
                border-radius:6px;padding:4px;}
        """)

        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        self.slider_sens = SliderRow("Чувствительность:", 10, 3000, int(self.config["sensitivity"] * 100), 100.0)
        self.slider_sens.slider.valueChanged.connect(self._on_change)
        layout.addWidget(self.slider_sens)

        mouth_count = self.config.get("mouth_count", 6)
        needed = max(1, mouth_count - 1)
        th_list = list(self.config.get("thresholds", []))

        self.thresh_box = CollapsibleBox("Пороги громкости (%)")
        thresh_widget = QWidget()
        sl = QVBoxLayout(thresh_widget)
        sl.setContentsMargins(10, 5, 10, 5)

        btn_auto = QPushButton("✨ Авто-распределение")
        btn_auto.clicked.connect(self._auto_thresh)
        sl.addWidget(btn_auto)

        self.slider_thresh = []
        for i, v in enumerate(th_list[:needed]):
            row = SliderRow(f"Порог {i+1}→{i+2}:", 1, 100, int(v), 1.0, "%")
            self.slider_thresh.append(row)
            sl.addWidget(row)
            row.slider.valueChanged.connect(self._on_change)
            row.slider.valueChanged.connect(lambda val, idx=i: self._update_thresh_limits(idx))

        self.thresh_box.setContentLayout(sl)
        layout.addWidget(self.thresh_box)
        for i in range(len(self.slider_thresh)):
            self._update_thresh_limits(i)

        self.slider_blink_freq = SliderRow("Частота моргания:", 10, 100, int(self.config.get("blink_interval", 5.0) * 10), 10.0, " сек")
        self.slider_blink_freq.slider.valueChanged.connect(self._on_change)
        layout.addWidget(self.slider_blink_freq)

        self.slider_blink_dur = SliderRow("Длительность моргания:", 100, 2000, self.config.get("blink_duration", 300), 1.0, " мс")
        self.slider_blink_dur.slider.valueChanged.connect(self._on_change)
        layout.addWidget(self.slider_blink_dur)

        self.slider_shake = SliderRow("Сила тряски:", 0, 30, self.config.get("shake_force", 8))
        self.slider_shake.slider.valueChanged.connect(self._on_change)
        layout.addWidget(self.slider_shake)

        self.slider_mem = MemRow("Лимит памяти:", 100, 1000, self.config.get("memory_limit_mb", 300))
        self.slider_mem.slider.valueChanged.connect(self._on_change)
        layout.addWidget(self.slider_mem)

        key_h = QHBoxLayout()
        key_h.addWidget(QLabel("Клавиша Rage:"))
        self.entry_key = QLineEdit()
        self.entry_key.setMaxLength(1)
        self.entry_key.setText(self.config.get("rage_key", "j").lower())
        self.entry_key.textChanged.connect(self._on_change)
        key_h.addWidget(self.entry_key)
        layout.addLayout(key_h)

        btn_layout = QHBoxLayout()
        btn_save = QPushButton("Сохранить")
        btn_save.setObjectName("primary")
        btn_close = QPushButton("Закрыть")
        btn_reset = QPushButton("Сброс")
        btn_layout.addWidget(btn_save)
        btn_layout.addWidget(btn_close)
        btn_layout.addWidget(btn_reset)
        layout.addLayout(btn_layout)

        btn_save.clicked.connect(self._save)
        btn_close.clicked.connect(self.close)
        btn_reset.clicked.connect(self._reset)

    def _auto_thresh(self):
        n = len(self.slider_thresh)
        if n == 0: return
        step = 100 // (n + 1)
        for i in range(n):
            self.slider_thresh[i].slider.setValue((i + 1) * step)

    def _on_change(self, _=None):
        if self.parent() and hasattr(self.parent(), 'update_live_settings'):
            self.parent().update_live_settings(self.get_config())

    def _save(self):
        if self.on_save:
            self.on_save(self.get_config())

    def _update_thresh_limits(self, changed_idx):
        val = self.slider_thresh[changed_idx].slider.value()
        for i in range(changed_idx + 1, len(self.slider_thresh)):
            if self.slider_thresh[i].slider.value() <= val:
                self.slider_thresh[i].slider.blockSignals(True)
                self.slider_thresh[i].slider.setValue(val + 1)
                self.slider_thresh[i].slider.blockSignals(False)
                self.slider_thresh[i]._on_change(val + 1)
        for i in range(changed_idx - 1, -1, -1):
            if self.slider_thresh[i].slider.value() >= val:
                self.slider_thresh[i].slider.blockSignals(True)
                self.slider_thresh[i].slider.setValue(val - 1)
                self.slider_thresh[i].slider.blockSignals(False)
                self.slider_thresh[i]._on_change(val - 1)

    def _reset(self):
        self.slider_sens.slider.setValue(int(DEFAULT_CONFIG["sensitivity"] * 100))
        for i, row in enumerate(self.slider_thresh):
            if i < len(DEFAULT_CONFIG["thresholds"]):
                row.slider.setValue(DEFAULT_CONFIG["thresholds"][i])
        self.slider_blink_freq.slider.setValue(int(DEFAULT_CONFIG["blink_interval"] * 10))
        self.slider_blink_dur.slider.setValue(DEFAULT_CONFIG["blink_duration"])
        self.slider_shake.slider.setValue(DEFAULT_CONFIG["shake_force"])
        self.slider_mem.slider.setValue(DEFAULT_CONFIG.get("memory_limit_mb", 300))
        self.entry_key.setText(DEFAULT_CONFIG["rage_key"])

    def get_config(self):
        cfg = dict(self.config)
        cfg["sensitivity"] = self.slider_sens.slider.value() / 100.0
        cfg["thresholds"] = [r.slider.value() for r in self.slider_thresh]
        cfg["blink_interval"] = self.slider_blink_freq.slider.value() / 10.0
        cfg["blink_duration"] = self.slider_blink_dur.slider.value()
        cfg["shake_force"] = self.slider_shake.slider.value()
        cfg["memory_limit_mb"] = self.slider_mem.slider.value()
        cfg["rage_key"] = self.entry_key.text().lower() or "j"
        return cfg

def create_splash_pixmap():
    pixmap = QPixmap(450, 240)
    pixmap.fill(Qt.transparent)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.Antialiasing)
    painter.setBrush(QColor(20, 25, 38))
    painter.setPen(QPen(QColor(36, 44, 61), 2))
    painter.drawRoundedRect(0, 0, 450, 240, 20, 20)
    painter.setPen(QColor(47, 211, 154))
    painter.setFont(QFont("Segoe UI", 24, QFont.Bold))
    painter.drawText(QRect(0, 55, 450, 40), Qt.AlignCenter, "HEADVOICE")
    painter.setPen(QColor(230, 234, 243))
    painter.setFont(QFont("Segoe UI", 13, QFont.Bold))
    painter.drawText(QRect(0, 110, 450, 30), Qt.AlignCenter, "by CyHDoochok")
    painter.setPen(QColor(47, 211, 154))
    painter.setFont(QFont("Segoe UI", 12))
    painter.drawText(QRect(0, 145, 450, 30), Qt.AlignCenter, "@CyHDoochok_twitch")
    painter.end()
    return pixmap