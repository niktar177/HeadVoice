import sys
import os
import json
import glob
import shutil


def get_base_path():
    # Если запущено из собранного exe — берём папку с exe. Иначе — корень проекта.
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


BASE_DIR = get_base_path()
CONFIG_FILE = os.path.join(BASE_DIR, "config.json")
APP_CONFIG_FILE = os.path.join(BASE_DIR, "app_config.json")

# Дефолтные настройки. Если у юзера нет конфига — грузим это.
DEFAULT_CONFIG = {
    "sensitivity": 14.0,
    "thresholds": [6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56, 61, 66],
    "blink_interval": 5.0,
    "rage_key": "j",
    "shake_force": 10,
    "blink_duration": 806,
    "mouth_count": 14,
    "has_blinking": True,
    "has_rage": True,
    "blink_count": 23,
    "blink_only_eyes": False,
    "has_body": False,
    "memory_limit_mb": 300,
}


def get_models_dir():
    # Папка со всеми скинами. Создаём, если её нет
    d = os.path.join(BASE_DIR, "models")
    os.makedirs(d, exist_ok=True)
    return d


def get_model_dir(name):
    return os.path.join(get_models_dir(), name)


def list_models():
    # Возвращает список папок внутри models/. Сортируем для стабильности.
    d = get_models_dir()
    try:
        return sorted([n for n in os.listdir(d) if os.path.isdir(os.path.join(d, n))])
    except Exception:
        return []


def _load_app_config():
    # app_config хранит только текущую выбранную модель. Всё остальное — в конфиге модели.
    if not os.path.exists(APP_CONFIG_FILE):
        return {"current_model": None}
    try:
        with open(APP_CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"current_model": None}


def _save_app_config(cfg):
    try:
        with open(APP_CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Не удалось сохранить app_config: {e}")


_migrated = False


def _ensure_migration():
    # Миграция со старого формата (всё в корне) на новый (модели в models/).
    # Запускается один раз за сессию.
    global _migrated
    if _migrated:
        return
    _migrated = True
    try:
        legacy_cfg = os.path.join(BASE_DIR, "config.json")
        if os.path.exists(legacy_cfg) and not list_models():
            default_dir = os.path.join(get_models_dir(), "default")
            os.makedirs(default_dir, exist_ok=True)
            moved = False
            for pattern in ["image_mouth_*.png", "image_blink_*.png", "image_rage.png",
                            "skin.png", "RAW.json", "config.json"]:
                for path in glob.glob(os.path.join(BASE_DIR, pattern)):
                    try:
                        shutil.move(path, os.path.join(default_dir, os.path.basename(path)))
                        moved = True
                    except Exception:
                        pass
            if moved:
                cfg = _load_app_config()
                cfg["current_model"] = "default"
                _save_app_config(cfg)
    except Exception as e:
        print(f"Migration error: {e}")


def get_current_model():
    # Возвращает имя активной модели. Если сохранённая не существует — берём первую попавшуюся.
    _ensure_migration()
    cfg = _load_app_config()
    name = cfg.get("current_model")
    models = list_models()
    if name and name in models:
        return name
    if models:
        cfg["current_model"] = models[0]
        _save_app_config(cfg)
        return models[0]
    return None


def set_current_model(name):
    cfg = _load_app_config()
    cfg["current_model"] = name
    _save_app_config(cfg)


def get_current_model_dir():
    name = get_current_model()
    if name:
        return get_model_dir(name)
    # Если моделей нет — фолбэк на корень (легаси-режим)
    return BASE_DIR


def _get_config_path(model_name=None):
    if model_name is None:
        model_name = get_current_model()
    if model_name is None:
        return CONFIG_FILE
    return os.path.join(get_model_dir(model_name), "config.json")


def find_editor_html():
    # Ищем editor.html. Сначала во временной папке PyInstaller (если в one-file exe),
    # потом рядом с exe, потом в папке проекта.
    candidates = []
    if getattr(sys, 'frozen', False):
        meipass = getattr(sys, '_MEIPASS', None)
        if meipass:
            candidates.append(os.path.join(meipass, "editor.html"))
        candidates.append(os.path.join(os.path.dirname(sys.executable), "editor.html"))

    candidates.extend([
        os.path.join(BASE_DIR, "editor.html"),
        os.path.join(os.getcwd(), "editor.html"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "editor.html"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "editor.html"),
    ])
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def load_config(model_name=None):
    _ensure_migration()
    config_path = _get_config_path(model_name)
    if not os.path.exists(config_path):
        return dict(DEFAULT_CONFIG)
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception:
        return dict(DEFAULT_CONFIG)

    # Легаси-формат: пороги были от 0 до 1. Конвертим в проценты.
    th = cfg.get("thresholds", [])
    if th and th[0] < 1.0:
        th = [max(1, int(t * 100)) for t in th]
        cfg["thresholds"] = th

    # Затыкаем дырки дефолтами, если в конфиге чё-то не хватает
    for k, v in DEFAULT_CONFIG.items():
        cfg.setdefault(k, v)

    # Если порогов меньше, чем нужно для текущего mouth_count — добиваем последними +5%
    mouth_count = cfg.get("mouth_count", 14)
    needed = max(1, mouth_count - 1)
    th = list(cfg.get("thresholds", []))
    while len(th) < needed:
        last = th[-1] if th else 1
        th.append(min(100, last + 5))
    cfg["thresholds"] = th[:needed]
    return cfg


def save_config(cfg, model_name=None):
    _ensure_migration()
    config_path = _get_config_path(model_name)
    try:
        os.makedirs(os.path.dirname(config_path), exist_ok=True)
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Не удалось сохранить config: {e}")