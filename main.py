import sys
import os
import glob
import ctypes
import logging
import traceback
from PyQt5.QtWidgets import (
    QApplication, QSplashScreen, QMessageBox, QDialog,
    QLineEdit, QTextEdit, QPlainTextEdit
)
from PyQt5.QtCore import QTimer, Qt, QEvent

from headvoice.ui import create_splash_pixmap, open_editor, CustomMessageBox
from headvoice.prelaunch import PreLaunchWindow
from headvoice.mic_window import MicWindow
from headvoice.config import BASE_DIR, get_current_model_dir


class HeadVoiceApp(QApplication):
    # Переопределяем notify, чтобы придушить системный писк Windows.
    # Винда начинает орать, если нажать букву, когда фокус на кнопке или ползунке.
    # Если фокус не в строке ввода — просто съедаем нажатие.
    def notify(self, receiver, event):
        if event.type() == QEvent.KeyPress:
            focus = self.focusWidget()
            if not isinstance(focus, (QLineEdit, QTextEdit, QPlainTextEdit)):
                # Пробел пропускаем, иначе кнопки перестанут нажиматься
                if event.text() and event.text().isprintable() and event.key() != Qt.Key_Space:
                    return True
        return super().notify(receiver, event)


def is_admin():
    # Проверка прав. Если без админа, хуки клавы не пробьются в игру,
    # запущенную от админа.
    try:
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        return False


# Логи пишем рядом с exe. Если у юзера что-то крашнется, попросим скинуть этот файл.
log_file = os.path.join(BASE_DIR, "headvoice.log")
logging.basicConfig(
    filename=log_file,
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    encoding='utf-8'
)


def handle_exception(exc_type, exc_value, exc_traceback):
    # Глобальный отлов крашей. Вместо молчаливого вылета покажем окошко
    # и запишем полный трейсбек в лог.
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return
    tb = "".join(traceback.format_exception(exc_type, exc_value, exc_traceback))
    logging.error("Необработанное исключение:\n" + tb)
    QMessageBox.critical(None, "Ошибка HeadVoice",
                         f"Произошла ошибка:\n{exc_value}\n\n"
                         f"Подробности в headvoice.log")
    sys.exit(1)


sys.excepthook = handle_exception


def after_splash(app, splash, result):
    # Убираем заставку и показываем окно предзапуска
    splash.finish(None)
    pre = PreLaunchWindow()
    pre.show()
    result["prelaunch"] = pre

    def watch():
        # Ждём, пока юзер что-то выберет в прелоадере
        if pre.isVisible():
            QTimer.singleShot(250, watch)
            return

        # Если нажал "Запустить"
        if pre.launch_requested and result["window"] is None:
            skin_dir = get_current_model_dir()

            # Проверяем, есть ли вообще картинки. Если скина нет — предлагаем открыть редактор.
            if not glob.glob(os.path.join(skin_dir, "image_mouth_*.png")):
                msg = CustomMessageBox(
                    None, "Скин не найден",
                    "Файлы скина не найдены для текущей модели.\n"
                    "Открыть редактор, чтобы создать их?",
                    is_question=True
                )
                if msg.exec_() == QDialog.Accepted:
                    open_editor(None)
                    pre.launch_requested = False
                    pre.show()
                    QTimer.singleShot(250, watch)
                    return

            # Скин на месте, запускаем главное окно
            try:
                w = MicWindow()
                w.show()
                result["window"] = w
            except Exception as e:
                logging.error(f"Ошибка запуска MicWindow: {e}")
                QMessageBox.critical(None, "Ошибка",
                                     f"Не удалось запустить HeadVoice:\n{e}")
                app.quit()
            return

        # Если окно закрыли и не стали запускать — выходим
        if result["window"] is None:
            app.quit()

    watch()


def main():
    logging.info("Запуск HeadVoice")
    logging.info(f"BASE_DIR = {BASE_DIR}")

    if not is_admin():
        logging.info(
            "Запущено без прав администратора. "
            "Клавиша Rage может не срабатывать в приложениях/играх, "
            "запущенных от админа."
        )

    # Юзаем наш кастомный класс, который глушит писк
    app = HeadVoiceApp(sys.argv)
    # Программа не должна закрываться, если свернуть окно
    app.setQuitOnLastWindowClosed(False)

    # Рисуем сплэш
    splash_pix = create_splash_pixmap()
    splash = QSplashScreen(splash_pix,
                           Qt.WindowStaysOnTopHint | Qt.FramelessWindowHint)
    splash.setAttribute(Qt.WA_TranslucentBackground)
    splash.show()

    result = {"window": None, "prelaunch": None}

    # Даём заставке повисеть 1.8 секунды, чтобы выглядело солидно
    QTimer.singleShot(1800, lambda: after_splash(app, splash, result))
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()