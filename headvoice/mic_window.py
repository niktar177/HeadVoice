import os
import random
import logging
import gc
import ctypes
from PyQt5.QtWidgets import (
    QWidget, QMenu, QAction, QApplication
)
from PyQt5.QtCore import QTimer, Qt, QPoint
from PyQt5.QtGui import QPixmap, QPainter, QColor

from .config import (
    load_config, save_config, DEFAULT_CONFIG, BASE_DIR,
    get_current_model, get_current_model_dir, set_current_model, list_models
)
from .ui import SettingsDialog, open_editor
from .memory_utils import get_memory_usage_mb
from .audio_manager import AudioManager
from .hotkey_manager import HotkeyManager


class MicWindow(QWidget):
    # Главное окно со скином. 256x256, без рамки, прозрачный фон.
    def __init__(self):
        super().__init__()
        self.setFixedSize(256, 256)
        self.setWindowFlags(Qt.FramelessWindowHint | Qt.NoDropShadowWindowHint)
        self.setAttribute(Qt.WA_TranslucentBackground, True)
        # Стартовая позиция — правый верхний угол с отступом
        geo = QApplication.primaryScreen().geometry()
        self.move(geo.width() - 300, 80)
        self._drag_pos = QPoint()

        self.config = load_config()
        self.is_rage = False
        self.is_blinking = False
        self.blink_frame_idx = 0
        self.offset_x = 0
        self.offset_y = 0
        self.smooth_volume = 0.0
        self.level = 1

        self.load_images()

        # Аудио + хоткеи
        self.audio = AudioManager()
        self.audio.start()

        self.hotkeys = HotkeyManager(self)
        self.setup_hotkey()

        # Основной цикл обновления кадров (25 fps)
        self.timer = QTimer(self)
        self.timer.timeout.connect(self._update_frame)
        self.timer.start(40)

        # Отдельный таймер проверки аудио. В 40-мс цикле пытаться рестартовать
        # поток — плохая идея, будет спамить. Раз в 2 секунды — норм.
        self.audio_check_timer = QTimer(self)
        self.audio_check_timer.timeout.connect(self._check_audio)
        self.audio_check_timer.start(2000)

        # Моргание
        self.blink_timer = QTimer(self)
        self.blink_timer.timeout.connect(self._start_blink)
        self._reset_blink_timer()

        self.anim_timer = QTimer(self)
        self.anim_timer.timeout.connect(self._next_blink_frame)

        # Периодическая чистка памяти
        self.mem_timer = QTimer(self)
        self.mem_timer.timeout.connect(self._check_memory)
        self.mem_timer.start(10000)

    def _get_param(self, key, default=None):
        return self.config.get(key, DEFAULT_CONFIG.get(key, default))

    def _check_memory(self):
        # Если RSS > 80% от лимита — форсим gc и EmptyWorkingSet.
        # EmptyWorkingSet говорит винде "выкинь страницы из RAM, мы их не используем".
        limit = self._get_param("memory_limit_mb", 300)
        usage = get_memory_usage_mb()
        if usage > (limit * 0.8):
            logging.info(f"Memory usage ({usage:.1f} MB) exceeded 80% of limit "
                         f"({limit} MB). Cleaning up...")
            gc.collect()
            try:
                ctypes.windll.psapi.EmptyWorkingSet(
                    ctypes.windll.kernel32.GetCurrentProcess())
            except Exception:
                pass

    def _check_audio(self):
        # Если поток умер или не открылся — пробуем заново.
        # Молча — юзер ничего не заметит.
        if not self.audio.is_active():
            logging.info("Audio stream inactive, attempting restart")
            self.audio.start()

    def load_images(self):
        # Загружаем все PNG для текущего скина. Сразу ресайзим под 256x256.
        self.mouth_images = []
        self.blink_images = []
        self.rage_image = None

        model_dir = get_current_model_dir()

        n = self._get_param("mouth_count", 6)
        for i in range(1, n + 1):
            p = os.path.join(model_dir, f"image_mouth_{i}.png")
            if os.path.exists(p):
                pm = QPixmap(p).scaled(256, 256, Qt.IgnoreAspectRatio,
                                       Qt.FastTransformation)
                self.mouth_images.append(pm)

        # Если ни одного кадра рта не нашли — рисуем белый квадрат-заглушку,
        # чтобы юзер хоть что-то увидел и понял, что скин битый.
        if not self.mouth_images:
            pm = QPixmap(256, 256)
            pm.fill(QColor(255, 255, 255, 200))
            self.mouth_images.append(pm)

        m = self._get_param("blink_count", 3)
        for i in range(1, m + 1):
            p = os.path.join(model_dir, f"image_blink_{i}.png")
            if os.path.exists(p):
                pm = QPixmap(p).scaled(256, 256, Qt.IgnoreAspectRatio,
                                       Qt.FastTransformation)
                self.blink_images.append(pm)

        p = os.path.join(model_dir, "image_rage.png")
        if os.path.exists(p):
            pm = QPixmap(p).scaled(256, 256, Qt.IgnoreAspectRatio,
                                   Qt.FastTransformation)
            self.rage_image = pm

    def setup_hotkey(self):
        key = self._get_param("rage_key", "j").lower()
        # Колбэки теперь без аргументов — HotkeyManager сам эмитит сигнал
        self.hotkeys.bind(key, self._on_rage_press, self._on_rage_release)

    def _on_rage_press(self):
        # Летит уже в главном потоке благодаря QueuedConnection
        self.is_rage = True
        self.is_blinking = False
        self.anim_timer.stop()

    def _on_rage_release(self):
        self.is_rage = False

    def _reset_blink_timer(self):
        if self.blink_timer.isActive():
            self.blink_timer.stop()
        interval_ms = int(self._get_param("blink_interval", 5.0) * 1000)
        self.blink_timer.start(max(1000, interval_ms))

    def _start_blink(self):
        # Если в рейдж-режиме или кадров моргания меньше двух — смысла моргать нет
        if self.is_rage or len(self.blink_images) <= 1:
            return
        self.is_blinking = True
        self.blink_frame_idx = 1
        total_dur = self._get_param("blink_duration", 300)
        # blink_images[0] — открытые глаза (база). Остальные [1..N-1] — кадры моргания.
        # Делим длительность на (N-1), чтобы последний кадр отыграл полный отрезок.
        frames = max(1, len(self.blink_images) - 1)
        frame_dur = max(20, total_dur // frames)
        self.anim_timer.start(frame_dur)

    def _next_blink_frame(self):
        if not self.is_blinking:
            self.anim_timer.stop()
            return
        self.blink_frame_idx += 1
        if self.blink_frame_idx >= len(self.blink_images):
            # Дошли до конца — закрываем моргание
            self.is_blinking = False
            self.anim_timer.stop()
            return

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            # Запоминаем точку клика для перетаскивания
            self._drag_pos = event.globalPos() - self.frameGeometry().topLeft()
            event.accept()
        elif event.button() == Qt.RightButton:
            self.show_context_menu(event.globalPos())

    def mouseMoveEvent(self, event):
        if event.buttons() == Qt.LeftButton:
            self.move(event.globalPos() - self._drag_pos)
            event.accept()

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Escape:
            self.close()
        else:
            event.accept()

    def _update_frame(self):
        # Сглаживаем громкость, чтобы рот не дёргался на каждом блоке
        self.smooth_volume = 0.7 * self.smooth_volume + 0.3 * self.audio.volume
        sens = self._get_param("sensitivity", 1.5)
        v = self.smooth_volume * sens

        # Определяем уровень громкости по порогам
        thresholds = self._get_param("thresholds", DEFAULT_CONFIG["thresholds"])
        mouth_count = len(self.mouth_images)
        level = 1
        for i, t in enumerate(thresholds):
            if i < mouth_count - 1 and v > t / 100.0:
                level = i + 2
        self.level = min(level, mouth_count)

        # Тряска в рейдж-режиме
        if self.is_rage:
            force = min(self._get_param("shake_force", 8), 32)
            self.offset_x = random.randint(-force, force)
            self.offset_y = random.randint(-force, force)
        else:
            self.offset_x = 0
            self.offset_y = 0

        self.update()

    def paintEvent(self, event):
        # Рисуем слоями: сначала рот, потом глаза, потом рейдж.
        # Рот меняется по громкости, глаза — по таймеру моргания.
        painter = QPainter(self)
        painter.setRenderHint(QPainter.SmoothPixmapTransform, False)
        painter.setClipRect(0, 0, 256, 256)

        # 1. Рот. Всегда рисуем базовый кадр, потом поверх — текущий уровень.
        if self.mouth_images:
            painter.drawPixmap(self.offset_x, self.offset_y, self.mouth_images[0])
        idx = max(0, min(self.level - 1, len(self.mouth_images) - 1))
        if idx > 0 and len(self.mouth_images) > 1:
            painter.drawPixmap(self.offset_x, self.offset_y, self.mouth_images[idx])

        # 2. Глаза (не рисуем в рейдж-режиме, там рейдж-картинка перекроет)
        if not self.is_rage and self.blink_images:
            # Всегда базовый кадр (открытые глаза)
            painter.drawPixmap(self.offset_x, self.offset_y, self.blink_images[0])
            # Если моргаем — поверх рисуем кадр с веком
            if self.is_blinking:
                blink_idx = min(self.blink_frame_idx, len(self.blink_images) - 1)
                painter.drawPixmap(self.offset_x, self.offset_y,
                                   self.blink_images[blink_idx])

        # 3. Рейдж — самый верхний слой
        if self.is_rage and self.rage_image:
            painter.drawPixmap(self.offset_x, self.offset_y, self.rage_image)

    def show_context_menu(self, pos):
        # ПКМ по окну — контекстное меню
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu{background:#141926;color:#e6eaf3;border:1px solid #2a3242;}
            QMenu::item:selected{background:#212b40;}
        """)

        act_editor = QAction("Открыть редактор", self)
        act_editor.triggered.connect(self._open_editor)
        act_settings = QAction("Настройки...", self)
        act_settings.triggered.connect(self._open_settings_dialog)
        act_update = QAction("Обновить", self)
        act_update.triggered.connect(self._update_all)
        act_exit = QAction("Выход", self)
        act_exit.triggered.connect(self.close)

        menu.addAction(act_editor)
        menu.addSeparator()
        menu.addAction(act_settings)
        menu.addAction(act_update)
        menu.addSeparator()
        menu.addAction(act_exit)
        menu.exec_(pos)

    def update_live_settings(self, new_cfg):
        # Вызывается из окна настроек на каждое изменение ползунка.
        # Обновляем конфиг в памяти и перезапускаем таймер моргания (интервал мог поменяться).
        self.config = new_cfg
        self._reset_blink_timer()
        self.update()

    def on_model_changed(self, name):
        # Сменили скин — перезагружаем картинки и конфиг
        self.config = load_config(name)
        self.is_rage = False
        self.is_blinking = False
        self.anim_timer.stop()
        self.load_images()
        self._reset_blink_timer()
        self.setup_hotkey()
        self.update()

    def _open_settings_dialog(self):
        dlg = getattr(self, '_settings_dialog', None)
        if dlg is not None and dlg.isVisible():
            # Окно уже открыто — просто фокусим
            dlg.raise_()
            dlg.activateWindow()
            return
        # Старый диалог висит в памяти — удаляем
        if dlg is not None:
            dlg.deleteLater()
            self._settings_dialog = None

        def save_cb(cfg):
            self.config = cfg
            save_config(cfg)

        self._settings_dialog = SettingsDialog(self.config, self, save_cb)
        self._settings_dialog.show()

    def _update_all(self):
        # Пункт "Обновить" в контекстном меню. Перечитываем конфиг и скин с диска.
        if get_current_model() is None and list_models():
            set_current_model(list_models()[0])
        self.config = load_config()
        self.load_images()
        self._reset_blink_timer()
        self.setup_hotkey()

    def _open_editor(self):
        open_editor(self)

    def closeEvent(self, event):
        # Прибираемся: таймеры, хоткеи, аудио.
        try:
            self.audio_check_timer.stop()
            self.hotkeys.cleanup()
            self.audio.stop()
        except Exception:
            pass
        super().closeEvent(event)
        app = QApplication.instance()
        if app:
            app.quit()