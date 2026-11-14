import os
import webbrowser
from PyQt5.QtCore import QUrl
from PyQt5.QtGui import QDesktopServices
from .config import find_editor_html
from .widgets import CustomMessageBox


def open_html_in_browser(path, parent=None):
    # Пытаемся открыть через QDesktopServices (уважает ассоциации винды),
    # если не вышло — фолбэк на webbrowser.
    if not path or not os.path.exists(path):
        CustomMessageBox(parent, "Ошибка", f"Файл не найден:\n{path}").exec_()
        return False
    try:
        if QDesktopServices.openUrl(QUrl.fromLocalFile(path)):
            return True
    except Exception:
        pass
    try:
        webbrowser.open(f"file:///{path.replace(os.sep, '/')}")
        return True
    except Exception:
        return False


def open_editor(parent=None):
    # Открывает editor.html в дефолтном браузере
    return open_html_in_browser(find_editor_html(), parent)