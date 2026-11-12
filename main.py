import sys
import os
import glob
import logging
import traceback
from PyQt5.QtWidgets import QApplication, QSplashScreen, QMessageBox
from PyQt5.QtCore import QTimer, Qt

from headvoice.ui import create_splash_pixmap, open_editor
from headvoice.prelaunch import PreLaunchWindow
from headvoice.mic_window import MicWindow
from headvoice.config import BASE_DIR

log_file = os.path.join(BASE_DIR, "headvoice.log")
logging.basicConfig(
    filename=log_file,
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    encoding='utf-8'
)

def handle_exception(exc_type, exc_value, exc_traceback):
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return
    tb = "".join(traceback.format_exception(exc_type, exc_value, exc_traceback))
    logging.error("Необработанное исключение:\n" + tb)
    QMessageBox.critical(None, "Ошибка HeadVoice", f"Произошла ошибка:\n{exc_value}\n\nПодробности в headvoice.log")
    sys.exit(1)

sys.excepthook = handle_exception

def after_splash(app, splash, result):
    splash.finish(None)
    pre = PreLaunchWindow()
    pre.show()
    result["prelaunch"] = pre

    def watch():
        if pre.isVisible():
            QTimer.singleShot(250, watch)
            return

        if pre.launch_requested and result["window"] is None:
            if not glob.glob(os.path.join(BASE_DIR, "image_mouth_*.png")):
                reply = QMessageBox.question(
                    None, "Скин не найден",
                    "Файлы скина не найдены в папке программы.\n"
                    "Открыть редактор, чтобы создать их?",
                    QMessageBox.Yes | QMessageBox.No, QMessageBox.Yes
                )
                if reply == QMessageBox.Yes:
                    open_editor(None)
                    pre.launch_requested = False
                    pre.show()
                    QTimer.singleShot(250, watch)
                    return
            try:
                w = MicWindow()
                w.show()
                result["window"] = w
            except Exception as e:
                logging.error(f"Ошибка запуска MicWindow: {e}")
                QMessageBox.critical(None, "Ошибка", f"Не удалось запустить HeadVoice:\n{e}")
                app.quit()
            return

        if result["window"] is None:
            app.quit()

    watch()

def main():
    logging.info("Запуск HeadVoice")
    logging.info(f"BASE_DIR = {BASE_DIR}")

    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)

    splash_pix = create_splash_pixmap()
    splash = QSplashScreen(splash_pix, Qt.WindowStaysOnTopHint | Qt.FramelessWindowHint)
    splash.setAttribute(Qt.WA_TranslucentBackground)
    splash.show()

    result = {"window": None, "prelaunch": None}
    QTimer.singleShot(1800, lambda: after_splash(app, splash, result))
    sys.exit(app.exec_())

if __name__ == "__main__":
    main()