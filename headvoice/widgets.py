import os
from PyQt5.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QLabel,
    QDialog, QSlider, QApplication
)
from PyQt5.QtCore import Qt, QRect, QTimer
from PyQt5.QtGui import QPixmap, QPainter, QColor, QFont, QPen


class CustomMessageBox(QDialog):
    # Кастомный MessageBox. Стандартный QMessageBox в винде издаёт системный звук,
    # да и выглядит инородно на фоне тёмной темы.
    def __init__(self, parent, title, text, is_question=False):
        super().__init__(parent)
        self.setWindowFlags(Qt.FramelessWindowHint | Qt.Dialog | Qt.WindowStaysOnTopHint)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setModal(True)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        container = QWidget()
        container.setObjectName("msgContainer")
        container.setStyleSheet("""
            QWidget#msgContainer {
                background: #141926;
                border: 1px solid #2a3242;
                border-radius: 12px;
            }
            QLabel { color: #e6eaf3; font-size: 13px; }
            QPushButton { 
                background: #182031; color: #dbe3f2; border: 1px solid #2a3242;
                border-radius: 8px; padding: 6px 16px;
            }
            QPushButton:hover { background: #212b40; }
            QPushButton#primary { background: #33dba1; color: #04120c; font-weight: bold; }
        """)
        layout.addWidget(container)

        vbox = QVBoxLayout(container)
        vbox.setContentsMargins(20, 20, 20, 20)
        vbox.setSpacing(15)

        lbl_title = QLabel(title)
        lbl_title.setStyleSheet("font-weight: bold; font-size: 15px; color: #2fd39a;")
        vbox.addWidget(lbl_title)

        lbl_text = QLabel(text)
        lbl_text.setWordWrap(True)
        vbox.addWidget(lbl_text)

        hbox = QHBoxLayout()
        hbox.addStretch()

        if is_question:
            btn_no = QPushButton("Нет")
            btn_no.clicked.connect(self.reject)
            hbox.addWidget(btn_no)

            btn_yes = QPushButton("Да")
            btn_yes.setObjectName("primary")
            btn_yes.clicked.connect(self.accept)
            hbox.addWidget(btn_yes)
        else:
            btn_ok = QPushButton("OK")
            btn_ok.setObjectName("primary")
            btn_ok.clicked.connect(self.accept)
            hbox.addWidget(btn_ok)

        vbox.addLayout(hbox)
        self.resize(320, 150)


def show_toast(parent, text, timeout=2000):
    # Тосты, которые сами исчезают через пару секунд
    toast = QDialog(parent)
    toast.setWindowFlags(Qt.FramelessWindowHint | Qt.Tool | Qt.WindowStaysOnTopHint)
    toast.setAttribute(Qt.WA_TranslucentBackground)
    layout = QVBoxLayout(toast)
    layout.setContentsMargins(0, 0, 0, 0)
    lbl = QLabel(text)
    lbl.setStyleSheet("""
        background: #141926; color: #2fd39a; border: 1px solid #2fd39a;
        border-radius: 8px; padding: 10px 20px; font-weight: bold;
    """)
    layout.addWidget(lbl)
    toast.adjustSize()

    # Центрируем относительно родителя или экрана
    if parent:
        geo = parent.geometry()
        toast.move(geo.center().x() - toast.width()//2, geo.center().y() - toast.height()//2)
    else:
        screen = QApplication.primaryScreen().geometry()
        toast.move((screen.width() - toast.width())//2, (screen.height() - toast.height())//2)

    toast.show()
    QTimer.singleShot(timeout, toast.close)
    return toast


class CollapsibleBox(QWidget):
    # Выпадающий аккордеон. Кликнул по заголовку — раскрылось.
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

        self.content_area = QWidget()
        self.content_area.setVisible(False)

        lay = QVBoxLayout(self)
        lay.addWidget(self.toggle_button)
        lay.addWidget(self.content_area)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setAlignment(Qt.AlignTop)

    def on_toggled(self, checked):
        self.content_area.setVisible(checked)
        # Меняем стрелочку
        self.toggle_button.setText(("▼ " if checked else "▶ ") + self._title)

    def setContentLayout(self, layout):
        self.content_area.setLayout(layout)


class SliderRow(QWidget):
    # Универсальная строка с ползунком и цифрами
    def __init__(self, label_text, min_val, max_val, current_val, divisor=1.0, suffix=""):
        super().__init__()
        h = QHBoxLayout(self)
        h.setContentsMargins(0, 0, 0, 0)

        self.lbl = QLabel(label_text)
        # Жёстко фиксируем ширину. Иначе при изменении цифр ползунок будет дёргаться влево-вправо
        self.lbl.setFixedWidth(140)

        self.val_lbl = QLabel()
        self.val_lbl.setStyleSheet("color:#e6eaf3;font-weight:bold;")
        self.val_lbl.setFixedWidth(80) # Ширина под "100 МБ", чтобы не обрезалось
        self.val_lbl.setAlignment(Qt.AlignRight | Qt.AlignVCenter)

        self.slider = QSlider(Qt.Horizontal)
        self.slider.setRange(min_val, max_val)
        self.slider.setValue(current_val)
        self.divisor = divisor
        self.suffix = suffix
        self.slider.valueChanged.connect(self._on_change)
        self._on_change(current_val)

        h.addWidget(self.lbl)
        h.addWidget(self.slider, 1)
        h.addWidget(self.val_lbl)

    def _on_change(self, v):
        # Если есть делитель, выводим float (1.5 сек), иначе int
        val = v / self.divisor if self.divisor != 1.0 else v
        if isinstance(val, float):
            self.val_lbl.setText(f"{val:.2f}{self.suffix}")
        else:
            self.val_lbl.setText(f"{val}{self.suffix}")


class MemRow(QWidget):
    # Отдельный класс для памяти, потому что нужна иконка-подсказка
    def __init__(self, label_text, min_val, max_val, current_val):
        super().__init__()
        h = QHBoxLayout(self)
        h.setContentsMargins(0, 0, 0, 0)

        self.lbl = QLabel(label_text)
        self.lbl.setFixedWidth(140)

        self.help_icon = QLabel("💡")
        self.help_icon.setToolTip("РЕКОМЕНДУЕТСЯ 250-300 МБ\nПри достижении 80% от лимита программа принудительно очистит память.")
        self.help_icon.setStyleSheet("color: #2fd39a; font-weight: bold; cursor: help; padding-left: 4px;")

        self.val_lbl = QLabel()
        self.val_lbl.setStyleSheet("color:#e6eaf3;font-weight:bold;")
        self.val_lbl.setFixedWidth(80)
        self.val_lbl.setAlignment(Qt.AlignRight | Qt.AlignVCenter)

        self.slider = QSlider(Qt.Horizontal)
        self.slider.setRange(min_val, max_val)
        self.slider.setValue(current_val)
        self.slider.valueChanged.connect(self._on_change)
        self._on_change(current_val)

        h.addWidget(self.lbl)
        h.addWidget(self.help_icon)
        h.addWidget(self.slider, 1)
        h.addWidget(self.val_lbl)

    def _on_change(self, v):
        self.val_lbl.setText(f"{v} МБ")


def create_splash_pixmap():
    # Рисуем заставку кодом, чтобы не таскать с собой PNG в exe
    pixmap = QPixmap(450, 240)
    pixmap.fill(Qt.transparent)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.Antialiasing)

    # Тёмный фон со скруглёнными углами
    painter.setBrush(QColor(20, 25, 38))
    painter.setPen(QPen(QColor(36, 44, 61), 2))
    painter.drawRoundedRect(0, 0, 450, 240, 20, 20)

    # Название
    painter.setPen(QColor(47, 211, 154))
    painter.setFont(QFont("Segoe UI", 24, QFont.Bold))
    painter.drawText(QRect(0, 55, 450, 40), Qt.AlignCenter, "HEADVOICE")

    # Автор
    painter.setPen(QColor(230, 234, 243))
    painter.setFont(QFont("Segoe UI", 13, QFont.Bold))
    painter.drawText(QRect(0, 110, 450, 30), Qt.AlignCenter, "by CyHDoochok")

    # Твич
    painter.setPen(QColor(47, 211, 154))
    painter.setFont(QFont("Segoe UI", 12))
    painter.drawText(QRect(0, 145, 450, 30), Qt.AlignCenter, "@CyHDoochok_twitch")

    painter.end()
    return pixmap