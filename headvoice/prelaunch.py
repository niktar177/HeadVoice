import os
from PyQt5.QtWidgets import (
    QWidget, QVBoxLayout, QLabel, QPushButton, QDialog, QApplication
)
from PyQt5.QtCore import Qt, QPoint

from .config import load_config, save_config
from .ui import SettingsDialog, open_editor


class PreLaunchWindow(QWidget):
    # Окно, которое показывается до запуска основного скина.
    # Типа лончера: "Редактор / Запустить / Настройки / Выход".
    def __init__(self):
        super().__init__()
        self.setFixedSize(420, 380)
        self.setWindowFlags(Qt.FramelessWindowHint)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self._drag_pos = QPoint()
        self.launch_requested = False
        self._build_ui()
        self._center()

    def _build_ui(self):
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)

        # Тёмная скруглённая панель
        container = QWidget()
        container.setObjectName("container")
        container.setStyleSheet("""
            QWidget#container{background:#141926;border:1px solid #242c3d;border-radius:20px;}
        """)
        outer.addWidget(container)

        layout = QVBoxLayout(container)
        layout.setContentsMargins(24, 24, 24, 24)
        layout.setSpacing(12)

        # Заголовок
        title = QLabel("HeadVoice")
        title.setAlignment(Qt.AlignCenter)
        title.setStyleSheet("color:#e6eaf3;font-size:26px;font-weight:800;letter-spacing:3px;")
        layout.addWidget(title)

        # Подпись с кликабельной ссылкой на твич
        sub = QLabel('by CyHDoochok · <a href="https://t.me/cyhdoochok_twitch" '
                     'style="color:#2fd39a;text-decoration:none;">@CyHDoochok_twitch</a>')
        sub.setTextFormat(Qt.RichText)
        sub.setTextInteractionFlags(Qt.TextBrowserInteraction)
        sub.setOpenExternalLinks(True)
        sub.setAlignment(Qt.AlignCenter)
        sub.setStyleSheet("color:#7f8ba3;font-size:11px;")
        layout.addWidget(sub)
        layout.addSpacing(10)

        # Кнопки
        btn_editor = QPushButton("🎨 Открыть редактор")
        btn_editor.setMinimumHeight(38)
        btn_editor.setStyleSheet("""
            QPushButton{background:#182031;color:#dbe3f2;border:1px solid #2a3242;
                border-radius:10px;font-size:14px;}
            QPushButton:hover{background:#212b40;border-color:#3a465f;}
        """)
        btn_editor.clicked.connect(self._open_editor)
        layout.addWidget(btn_editor)

        btn_launch = QPushButton("🚀 Запустить HeadVoice")
        btn_launch.setMinimumHeight(48)
        btn_launch.setStyleSheet("""
            QPushButton{background:qlineargradient(x1:0,y1:0,x2:0,y2:1,
                stop:0 #33dba1, stop:1 #1ba97a);
                color:#04120c;border:1px solid #33dba1;border-radius:10px;
                font-weight:800;font-size:15px;}
            QPushButton:hover{border-color:#55f0b5;}
        """)
        btn_launch.clicked.connect(self._launch)
        layout.addWidget(btn_launch)

        btn_settings = QPushButton("⚙ Настройки")
        btn_settings.setMinimumHeight(38)
        btn_settings.setStyleSheet("""
            QPushButton{background:#182031;color:#dbe3f2;border:1px solid #2a3242;
                border-radius:10px;font-size:14px;}
            QPushButton:hover{background:#212b40;border-color:#3a465f;}
        """)
        btn_settings.clicked.connect(self._open_settings)
        layout.addWidget(btn_settings)
        layout.addStretch()

        # Выход внизу, мелким текстом
        btn_exit = QPushButton("✕ Выход")
        btn_exit.setStyleSheet("""
            QPushButton{background:transparent;color:#7f8ba3;border:none;padding:6px;font-size:12px;}
            QPushButton:hover{color:#ff6b8a;}
        """)
        btn_exit.clicked.connect(self.close)
        layout.addWidget(btn_exit)

    def _center(self):
        # Центрируем окно на главном экране
        screen = QApplication.primaryScreen().geometry()
        self.move((screen.width() - self.width()) // 2,
                  (screen.height() - self.height()) // 2)

    def mousePressEvent(self, event):
        # Перетаскивание окна за любую точку (рамки-то нет)
        if event.button() == Qt.LeftButton:
            self._drag_pos = event.globalPos() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        if event.buttons() == Qt.LeftButton:
            self.move(event.globalPos() - self._drag_pos)
            event.accept()

    def keyPressEvent(self, event):
        # Съедаем все клавиши, чтобы окно случайно не закрылось по Esc
        event.accept()

    def _open_editor(self):
        open_editor(self)

    def _open_settings(self):
        cfg = load_config()

        def save_cb(new_cfg):
            save_config(new_cfg)

        dlg = SettingsDialog(cfg, self, save_cb)
        dlg.exec_()

    def _launch(self):
        # Ставим флаг и закрываемся. main.py следит за этим флагом и запускает MicWindow.
        self.launch_requested = True
        self.close()