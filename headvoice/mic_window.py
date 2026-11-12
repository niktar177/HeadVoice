import sys
import os
import random
import logging
import gc
import ctypes
import ctypes.wintypes
import numpy as np
import sounddevice as sd
import keyboard
from PyQt5.QtWidgets import (
    QWidget, QMenu, QAction, QDialog, QMessageBox, QApplication
)
from PyQt5.QtCore import QTimer, Qt, QPoint
from PyQt5.QtGui import QPixmap, QPainter, QColor

from .config import load_config, save_config, DEFAULT_CONFIG, BASE_DIR
from .ui import SettingsDialog, open_editor

# Структура для получения данных о памяти в Windows
class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
    _fields_ = [
        ('cb', ctypes.wintypes.DWORD),
        ('PageFaultCount', ctypes.wintypes.DWORD),
        ('PeakWorkingSetSize', ctypes.c_size_t),
        ('WorkingSetSize', ctypes.c_size_t),
        ('QuotaPeakPagedPoolUsage', ctypes.c_size_t),
        ('QuotaPagedPoolUsage', ctypes.c_size_t),
        ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t),
        ('QuotaNonPagedPoolUsage', ctypes.c_size_t),
        ('PagefileUsage', ctypes.c_size_t),
        ('PeakPagefileUsage', ctypes.c_size_t),
    ]

def get_memory_usage_mb():
    try:
        counters = PROCESS_MEMORY_COUNTERS()
        counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
        process = ctypes.windll.kernel32.GetCurrentProcess()
        ctypes.windll.psapi.GetProcessMemoryInfo(process, ctypes.byref(counters), counters.cb)
        return counters.WorkingSetSize / (1024 * 1024)
    except Exception:
        return 0.0

class MicWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setFixedSize(256, 256)
        self.setWindowFlags(Qt.FramelessWindowHint | Qt.NoDropShadowWindowHint)
        self.setAttribute(Qt.WA_TranslucentBackground, True)
        geo = QApplication.primaryScreen().geometry()
        self.move(geo.width() - 300, 80)
        self._drag_pos = QPoint()

        self.config = load_config()
        self._runtime_backup = dict(self.config)
        self.is_rage = False
        self.is_blinking = False
        self.blink_frame_idx = 0
        self.offset_x = 0
        self.offset_y = 0
        self.volume = 0.0
        self.smooth_volume = 0.0
        self.level = 1
        self._audio_error_count = 0

        self.load_images()

        self.samplerate = 44100
        self.blocksize = 1024
        try:
            self.stream = sd.InputStream(
                samplerate=self.samplerate,
                channels=1,
                blocksize=self.blocksize,
                callback=self._audio_cb,
            )
            self.stream.start()
        except Exception as e:
            logging.error(f"Mic error: {e}")
            self.stream = None

        # Таймер обновления громкости
        self.timer = QTimer(self)
        self.timer.timeout.connect(self._update_frame)
        self.timer.start(40)

        # Таймер частоты моргания
        self.blink_timer = QTimer(self)
        self.blink_timer.timeout.connect(self._start_blink)
        self._reset_blink_timer()

        # Таймер анимации моргания
        self.anim_timer = QTimer(self)
        self.anim_timer.timeout.connect(self._next_blink_frame)

        # Таймер проверки памяти (раз в 10 секунд)
        self.mem_timer = QTimer(self)
        self.mem_timer.timeout.connect(self._check_memory)
        self.mem_timer.start(10000)

        self.setup_hotkey()

    def _get_param(self, key, default=None):
        return self.config.get(key, DEFAULT_CONFIG.get(key, default))

    def _check_memory(self):
        limit = self._get_param("memory_limit_mb", 300)
        usage = get_memory_usage_mb()

        if usage > (limit * 0.8):
            logging.info(f"Memory usage ({usage:.1f} MB) exceeded 80% of limit ({limit} MB). Cleaning up...")
            gc.collect()
            try:
                # Очистка рабочего набора (Working Set) процесса в Windows
                ctypes.windll.psapi.EmptyWorkingSet(ctypes.windll.kernel32.GetCurrentProcess())
                new_usage = get_memory_usage_mb()
                logging.info(f"Cleanup complete. New usage: {new_usage:.1f} MB")
            except Exception as e:
                logging.error(f"Failed to trim working set: {e}")

    def load_images(self):
        self.mouth_images = []
        self.blink_images = []
        self.rage_image = None

        n = self._get_param("mouth_count", 6)
        for i in range(1, n + 1):
            p = os.path.join(BASE_DIR, f"image_mouth_{i}.png")
            if os.path.exists(p):
                pm = QPixmap(p).scaled(256, 256, Qt.IgnoreAspectRatio, Qt.FastTransformation)
                self.mouth_images.append(pm)

        if not self.mouth_images:
            for i in range(1, 7):
                p = os.path.join(BASE_DIR, f"image{i}.png")
                if os.path.exists(p):
                    pm = QPixmap(p).scaled(256, 256, Qt.IgnoreAspectRatio, Qt.FastTransformation)
                    self.mouth_images.append(pm)

        if not self.mouth_images:
            pm = QPixmap(256, 256)
            pm.fill(QColor(255, 255, 255, 200))
            self.mouth_images.append(pm)

        m = self._get_param("blink_count", 3)
        for i in range(1, m + 1):
            p = os.path.join(BASE_DIR, f"image_blink_{i}.png")
            if os.path.exists(p):
                pm = QPixmap(p).scaled(256, 256, Qt.IgnoreAspectRatio, Qt.FastTransformation)
                self.blink_images.append(pm)

        p = os.path.join(BASE_DIR, "image_rage.png")
        if os.path.exists(p):
            pm = QPixmap(p).scaled(256, 256, Qt.IgnoreAspectRatio, Qt.FastTransformation)
            self.rage_image = pm

    def setup_hotkey(self):
        try:
            keyboard.unhook_all()
            key = self._get_param("rage_key", "j").lower()
            keyboard.on_press_key(key, self._on_rage_press, suppress=False)
            keyboard.on_release_key(key, self._on_rage_release, suppress=False)
        except Exception as e:
            logging.error(f"Hotkey error: {e}")

    def _on_rage_press(self, _):
        self.is_rage = True
        self.is_blinking = False
        self.anim_timer.stop()

    def _on_rage_release(self, _):
        self.is_rage = False

    def _reset_blink_timer(self):
        if self.blink_timer.isActive():
            self.blink_timer.stop()
        interval_ms = int(self._get_param("blink_interval", 5.0) * 1000)
        self.blink_timer.start(max(1000, interval_ms))

    def _start_blink(self):
        if self.is_rage or len(self.blink_images) <= 1:
            return
        self.is_blinking = True
        self.blink_frame_idx = 1

        total_dur = self._get_param("blink_duration", 300)
        frame_dur = max(20, total_dur // len(self.blink_images))
        self.anim_timer.start(frame_dur)

    def _next_blink_frame(self):
        if not self.is_blinking:
            self.anim_timer.stop()
            return
        self.blink_frame_idx += 1
        if self.blink_frame_idx >= len(self.blink_images):
            self.is_blinking = False
            self.anim_timer.stop()
            return

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
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

    def _audio_cb(self, indata, frames, time, status):
        try:
            if status:
                self._audio_error_count += 1
                if self._audio_error_count % 100 == 0:
                    logging.warning(f"Audio status: {status}")
            rms = float(np.sqrt(np.mean(indata ** 2)))
            self.volume = rms
        except Exception as e:
            logging.error(f"Audio callback fatal: {e}")

    def _update_frame(self):
        self.smooth_volume = 0.7 * self.smooth_volume + 0.3 * self.volume
        sens = self._get_param("sensitivity", 1.5)
        v = self.smooth_volume * sens

        thresholds = self._get_param("thresholds", DEFAULT_CONFIG["thresholds"])
        mouth_count = len(self.mouth_images)
        level = 1
        for i, t in enumerate(thresholds):
            if i < mouth_count - 1 and v > t / 100.0:
                level = i + 2
        self.level = min(level, mouth_count)

        if self.is_rage:
            force = min(self._get_param("shake_force", 8), 32)
            self.offset_x = random.randint(-force, force)
            self.offset_y = random.randint(-force, force)
        else:
            self.offset_x = 0
            self.offset_y = 0

        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.SmoothPixmapTransform, False)
        painter.setClipRect(0, 0, 256, 256)

        if self.mouth_images:
            painter.drawPixmap(self.offset_x, self.offset_y, self.mouth_images[0])
        idx = max(0, min(self.level - 1, len(self.mouth_images) - 1))
        if idx > 0 and len(self.mouth_images) > 1:
            painter.drawPixmap(self.offset_x, self.offset_y, self.mouth_images[idx])

        if not self.is_rage and self.blink_images:
            if self.is_blinking:
                blink_idx = min(self.blink_frame_idx, len(self.blink_images) - 1)
                painter.drawPixmap(self.offset_x, self.offset_y, self.blink_images[blink_idx])
            else:
                painter.drawPixmap(self.offset_x, self.offset_y, self.blink_images[0])

        if self.is_rage and self.rage_image:
            painter.drawPixmap(self.offset_x, self.offset_y, self.rage_image)

    def show_context_menu(self, pos):
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
        self.config = new_cfg
        self._reset_blink_timer()
        self.update()

    def _open_settings_dialog(self):
        if hasattr(self, '_settings_dialog') and self._settings_dialog.isVisible():
            self._settings_dialog.raise_()
            self._settings_dialog.activateWindow()
            return

        def save_cb(cfg):
            self.config = cfg
            save_config(cfg)
            self._runtime_backup = dict(cfg)
            QMessageBox.information(self, "HeadVoice", "Настройки сохранены в файл!")

        self._settings_dialog = SettingsDialog(self.config, self, save_cb)
        self._settings_dialog.show()

    def _update_all(self):
        self.config = load_config()
        self._runtime_backup = dict(self.config)
        self.load_images()
        self._reset_blink_timer()
        self.setup_hotkey()
        QMessageBox.information(self, "HeadVoice", "Настройки и PNG-файлы успешно обновлены!")

    def _open_editor(self):
        open_editor(self)

    def closeEvent(self, event):
        try:
            keyboard.unhook_all()
            if self.stream:
                self.stream.stop()
                self.stream.close()
        except Exception:
            pass
        super().closeEvent(event)
        app = QApplication.instance()
        if app:
            app.quit()