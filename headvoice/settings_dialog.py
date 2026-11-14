import os
from PyQt5.QtWidgets import (
    QVBoxLayout, QHBoxLayout, QPushButton, QLabel, QDialog,
    QLineEdit, QWidget, QListWidget, QListWidgetItem, QScrollArea,
    QApplication
)
from PyQt5.QtCore import Qt, QSize
from PyQt5.QtGui import QIcon

from .config import (
    DEFAULT_CONFIG, load_config, set_current_model,
    get_current_model, list_models, get_model_dir
)
from .widgets import CollapsibleBox, SliderRow, MemRow, show_toast


class SettingsDialog(QDialog):
    def __init__(self, config, parent=None, on_save=None):
        super().__init__(parent)
        self.on_save = on_save
        self.setWindowTitle("Настройки HeadVoice")

        # Убираем дефолтную кнопку "?" из шапки винды
        self.setWindowFlags(self.windowFlags() & ~Qt.WindowContextHelpButtonHint)

        self.resize(540, 800)
        self.config = dict(config)
        self.initial_config = dict(config)
        self._content = None

        # Стили для всего окна. QScrollBar тоже стилизуем, иначе он будет светлым уродцем.
        self.setStyleSheet("""
            QDialog { background-color: #141926; color: #e6eaf3; }
            QLabel { color: #e6eaf3; font-size: 13px; }
            QSlider::groove:horizontal { height: 6px; background: #2a3242; border-radius: 3px; }
            QSlider::handle:horizontal { background: #2fd39a; width: 16px; margin: -5px 0; border-radius: 8px; }
            QSlider::sub-page:horizontal { background: #2fd39a; border-radius: 3px; }
            QPushButton { background: #182031; color: #dbe3f2; border: 1px solid #2a3242;
                border-radius: 10px; padding: 8px 14px; }
            QPushButton:hover { background: #212b40; border-color: #3a465f; }
            QPushButton#primary { background: #33dba1; color: #04120c; font-weight: bold; }
            QLineEdit { background: #182031; color: #e6eaf3; border: 1px solid #2a3242;
                border-radius: 6px; padding: 4px; }
            QScrollBar:vertical { background: #141926; width: 10px; margin: 0px; }
            QScrollBar::handle:vertical { background: #2a3242; min-height: 20px; border-radius: 5px; }
            QScrollBar::handle:vertical:hover { background: #3a465f; }
        """)

        self._outer = QVBoxLayout(self)
        self._outer.setContentsMargins(0, 0, 0, 0)

        # Если у юзера 14+ порогов, без скролла ползунки просто вылезут за экран. Заворачиваем.
        self._scroll = QScrollArea()
        self._scroll.setWidgetResizable(True)
        self._scroll.setFrameShape(QScrollArea.NoFrame)

        # QScrollArea — та ещё зараза, по умолчанию рисует белый фон. Заставляем быть тёмным.
        self._scroll.setStyleSheet("QScrollArea { background-color: #141926; border: none; }")
        self._scroll.viewport().setStyleSheet("background-color: #141926;")

        self._outer.addWidget(self._scroll)

        self._build_content()

    def _build_content(self):
        # Полная пересборка интерфейса. Нужна при смене скина,
        # чтобы подгрузить новое количество порогов.

        # Удаляем старый виджет, если он был, чтобы не текла память
        if self._content is not None:
            self._scroll.takeWidget()
            self._content.deleteLater()

        self._content = QWidget()
        self._content.setStyleSheet("background-color: #141926;")
        self._scroll.setWidget(self._content)

        layout = QVBoxLayout(self._content)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(12)

        # Прижимаем к верху. Иначе QVBoxLayout растянет всё на всю высоту и ползунки разъедутся.
        layout.setAlignment(Qt.AlignTop)

        # --- Блок со скинами ---
        models_box = CollapsibleBox("Модели (наборы скинов)")
        models_widget = QWidget()
        ml = QVBoxLayout(models_widget)
        ml.setContentsMargins(6, 6, 6, 6)

        models = list_models()
        current = get_current_model()

        if not models:
            lbl = QLabel("Нет сохранённых моделей.\nСоздайте скин в редакторе и сохраните в папку программы.")
            lbl.setWordWrap(True)
            lbl.setStyleSheet("color:#7f8ba3;padding:12px;")
            ml.addWidget(lbl)
        else:
            # Сетка с иконками скинов
            list_widget = QListWidget()
            list_widget.setViewMode(QListWidget.IconMode)
            list_widget.setIconSize(QSize(72, 72))
            list_widget.setGridSize(QSize(110, 128))
            list_widget.setMovement(QListWidget.Static)
            list_widget.setResizeMode(QListWidget.Adjust)
            list_widget.setSpacing(6)
            list_widget.setMinimumHeight(160)
            list_widget.setMaximumHeight(220)
            list_widget.setStyleSheet("""
                QListWidget{background:#0f1420;border:1px solid #2a3242;border-radius:8px;
                    color:#e6eaf3;padding:4px;}
                QListWidget::item{padding:4px;border-radius:8px;}
                QListWidget::item:hover{background:#182031;}
                QListWidget::item:selected{background:#173229;border:1px solid #2fd39a;
                    color:#2fd39a;}
            """)

            for name in models:
                model_dir = get_model_dir(name)
                # Берём первый кадр рта как превью скина
                thumb_path = os.path.join(model_dir, "image_mouth_1.png")
                item = QListWidgetItem()
                item.setText(name)
                item.setData(Qt.UserRole, name)
                if os.path.exists(thumb_path):
                    item.setIcon(QIcon(thumb_path))
                list_widget.addItem(item)

                # Подсвечиваем активный скин
                if name == current:
                    list_widget.setCurrentItem(item)

            def on_model_clicked(item):
                name = item.data(Qt.UserRole)
                if name and name != get_current_model():
                    self._switch_model(name)

            list_widget.itemClicked.connect(on_model_clicked)
            ml.addWidget(list_widget)

        models_box.setContentLayout(ml)
        models_box.toggle_button.setChecked(True)
        layout.addWidget(models_box)

        # --- Чувствительность ---
        self.slider_sens = SliderRow("Чувствительность:", 10, 3000,
                                     int(self.config["sensitivity"] * 100), 100.0)
        self.slider_sens.slider.valueChanged.connect(self._on_change)
        layout.addWidget(self.slider_sens)

        # --- Пороги ---
        mouth_count = self.config.get("mouth_count", 6)
        needed = max(1, mouth_count - 1)
        th_list = list(self.config.get("thresholds", []))

        self.thresh_box = CollapsibleBox("Пороги громкости (%)")
        thresh_widget = QWidget()
        sl = QVBoxLayout(thresh_widget)
        sl.setContentsMargins(10, 5, 10, 5)

        # Кнопка для ленивых
        btn_auto = QPushButton("✨ Авто-распределение")
        btn_auto.clicked.connect(self._auto_thresh)
        sl.addWidget(btn_auto)

        self.slider_thresh = []
        for i, v in enumerate(th_list[:needed]):
            row = SliderRow(f"Порог {i+1}→{i+2}:", 1, 100, int(v), 1.0, "%")
            self.slider_thresh.append(row)
            sl.addWidget(row)

            # Вешаем два эвента: обновление конфига и защиту от пересечения порогов
            row.slider.valueChanged.connect(self._on_change)
            row.slider.valueChanged.connect(lambda val, idx=i: self._update_thresh_limits(idx))

        self.thresh_box.setContentLayout(sl)
        layout.addWidget(self.thresh_box)

        # Прогоняем проверку при инициализации
        for i in range(len(self.slider_thresh)):
            self._update_thresh_limits(i)

        # --- Моргание ---
        self.slider_blink_freq = SliderRow("Частота моргания:", 10, 100,
                                           int(self.config.get("blink_interval", 5.0) * 10),
                                           10.0, " сек")
        self.slider_blink_freq.slider.valueChanged.connect(self._on_change)
        layout.addWidget(self.slider_blink_freq)

        self.slider_blink_dur = SliderRow("Длительность моргания:", 100, 2000,
                                          self.config.get("blink_duration", 300), 1.0, " мс")
        self.slider_blink_dur.slider.valueChanged.connect(self._on_change)
        layout.addWidget(self.slider_blink_dur)

        # --- Тряска ---
        self.slider_shake = SliderRow("Сила тряски:", 0, 30,
                                      self.config.get("shake_force", 8))
        self.slider_shake.slider.valueChanged.connect(self._on_change)
        layout.addWidget(self.slider_shake)

        # --- Память ---
        self.slider_mem = MemRow("Лимит памяти:", 100, 1000,
                                 self.config.get("memory_limit_mb", 300))
        self.slider_mem.slider.valueChanged.connect(self._on_change)
        layout.addWidget(self.slider_mem)

        # --- Клавиша Rage ---
        key_h = QHBoxLayout()
        key_h.addWidget(QLabel("Клавиша Rage:"))
        self.entry_key = QLineEdit()
        self.entry_key.setMaxLength(1) # Только один символ
        self.entry_key.setText(self.config.get("rage_key", "j").lower())
        self.entry_key.textChanged.connect(self._on_change)
        key_h.addWidget(self.entry_key)
        layout.addLayout(key_h)

        # --- Кнопки ---
        btn_layout = QHBoxLayout()
        btn_save = QPushButton("Сохранить")
        btn_save.setObjectName("primary") # Зелёная кнопка
        btn_close = QPushButton("Закрыть")
        btn_reset = QPushButton("Сброс")
        btn_layout.addWidget(btn_save)
        btn_layout.addWidget(btn_close)
        btn_layout.addWidget(btn_reset)
        layout.addLayout(btn_layout)

        btn_save.clicked.connect(self._save)
        btn_close.clicked.connect(self._cancel)
        btn_reset.clicked.connect(self._reset)

    def _switch_model(self, name):
        # Юзер кликнул на другой скин
        set_current_model(name)
        new_cfg = load_config(name)
        self.config = new_cfg
        self.initial_config = dict(new_cfg)

        # Перестраиваем весь интерфейс, так как у нового скина может быть
        # другое количество порогов (mouth_count)
        self._build_content()

        # Дёргаем главное окно, чтобы оно перерисовало скин
        if self.parent() and hasattr(self.parent(), 'on_model_changed'):
            self.parent().on_model_changed(name)

        try:
            show_toast(self, f"Модель: {name}")
        except Exception:
            pass

    def _cancel(self):
        # Откатываем настройки к тем, что были при открытии окна
        if self.parent() and hasattr(self.parent(), 'update_live_settings'):
            self.parent().update_live_settings(self.initial_config)
        self.reject()

    def _auto_thresh(self):
        # Раскидываем пороги равномерно от 1 до 100%
        n = len(self.slider_thresh)
        if n == 0: return
        step = 100 // (n + 1)
        for i in range(n):
            self.slider_thresh[i].slider.setValue((i + 1) * step)

    def _on_change(self, _=None):
        # Применяем настройки на лету. Юзер двигает ползунок — скин сразу реагирует.
        if self.parent() and hasattr(self.parent(), 'update_live_settings'):
            self.parent().update_live_settings(self.get_config())

    def _save(self):
        if self.on_save:
            self.on_save(self.get_config())
        self.accept()

    def _update_thresh_limits(self, changed_idx):
        # Чтобы пороги не пересекались. Двигаем 5-й — тянем за собой все остальные.
        # blockSignals спасает от бесконечной рекурсии.
        if changed_idx >= len(self.slider_thresh):
            return
        val = self.slider_thresh[changed_idx].slider.value()

        # Тянем пороги ниже вверх
        for i in range(changed_idx + 1, len(self.slider_thresh)):
            if self.slider_thresh[i].slider.value() <= val:
                self.slider_thresh[i].slider.blockSignals(True)
                self.slider_thresh[i].slider.setValue(val + 1)
                self.slider_thresh[i].slider.blockSignals(False)
                self.slider_thresh[i]._on_change(val + 1)

        # Тянем пороги выше вниз
        for i in range(changed_idx - 1, -1, -1):
            if self.slider_thresh[i].slider.value() >= val:
                self.slider_thresh[i].slider.blockSignals(True)
                self.slider_thresh[i].slider.setValue(val - 1)
                self.slider_thresh[i].slider.blockSignals(False)
                self.slider_thresh[i]._on_change(val - 1)

    def _reset(self):
        # Сброс к дефолтным значениям
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
        # Собираем актуальный конфиг из виджетов
        cfg = dict(self.config)
        cfg["sensitivity"] = self.slider_sens.slider.value() / 100.0
        cfg["thresholds"] = [r.slider.value() for r in self.slider_thresh]
        cfg["blink_interval"] = self.slider_blink_freq.slider.value() / 10.0
        cfg["blink_duration"] = self.slider_blink_dur.slider.value()
        cfg["shake_force"] = self.slider_shake.slider.value()
        cfg["memory_limit_mb"] = self.slider_mem.slider.value()
        cfg["rage_key"] = self.entry_key.text().lower() or "j"
        return cfg