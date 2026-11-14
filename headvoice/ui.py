# Удобный реэкспорт всего UI-хлама, чтобы не тянуть импорты из разных файлов
from .widgets import (
    CustomMessageBox, show_toast, CollapsibleBox,
    SliderRow, MemRow, create_splash_pixmap
)
from .web_utils import open_html_in_browser, open_editor
from .settings_dialog import SettingsDialog