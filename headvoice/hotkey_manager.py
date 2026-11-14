import logging
import keyboard
from PyQt5.QtCore import QObject, pyqtSignal, Qt


class HotkeyManager(QObject):
    # Обёртка над библиотекой keyboard.
    # ВАЖНО: keyboard вызывает колбэки из своего потока. Если из него дёргать
    # Qt-таймеры или виджеты — Qt может ругнуться или крашнуться.
    # Поэтому эмитим сигналы через QueuedConnection — Qt сам перекинет их в главный поток.

    pressed = pyqtSignal()
    released = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.current_key = None
        self._hooks = []

    def bind(self, key, on_press_cb, on_release_cb):
        self.unbind()
        self.current_key = key.lower()
        try:
            # QueuedConnection гарантирует доставку в главный поток Qt
            self.pressed.connect(on_press_cb, Qt.QueuedConnection)
            self.released.connect(on_release_cb, Qt.QueuedConnection)

            h1 = keyboard.on_press_key(
                self.current_key,
                lambda _e: self.pressed.emit(),
                suppress=False,
            )
            h2 = keyboard.on_release_key(
                self.current_key,
                lambda _e: self.released.emit(),
                suppress=False,
            )
            self._hooks = [h1, h2]
        except Exception as e:
            logging.error(f"Hotkey bind error for '{key}': {e}")
            # Если не биндится — скорее всего нет прав админа. Кидаем подсказку в лог.
            logging.info("Hint: некоторые игры требуют запуска HeadVoice "
                         "от имени администратора для перехвата клавиши.")

    def unbind(self):
        # Снимаем оба хука. Храним handle'ы отдельно, потому что unhook_key
        # в некоторых версиях keyboard снимает только один из двух.
        for h in self._hooks:
            try:
                keyboard.remove_hotkey(h)
            except Exception:
                pass
        self._hooks = []
        if self.current_key:
            try:
                keyboard.unhook_key(self.current_key)
            except Exception:
                pass
            self.current_key = None
        # Отрубаем сигналы от старых колбэков
        try:
            self.pressed.disconnect()
        except Exception:
            pass
        try:
            self.released.disconnect()
        except Exception:
            pass

    def cleanup(self):
        # Полная зачистка при выходе из программы
        self.unbind()
        try:
            keyboard.unhook_all()
        except Exception:
            pass