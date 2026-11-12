import sys
import os
import json

def get_base_path():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BASE_DIR = get_base_path()
CONFIG_FILE = os.path.join(BASE_DIR, "config.json")

DEFAULT_CONFIG = {
    "sensitivity": 1.5,
    "thresholds": [15, 30, 45, 60, 75],
    "blink_interval": 5.0,
    "blink_duration": 300,
    "rage_key": "j",
    "shake_force": 8,
    "mouth_count": 6,
    "has_blinking": True,
    "has_rage": True,
    "blink_count": 3,
    "blink_only_eyes": False,
    "memory_limit_mb": 300,
}

def find_editor_html():
    candidates = [
        os.path.join(BASE_DIR, "editor.html"),
        os.path.join(os.getcwd(), "editor.html"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "editor.html"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "editor.html"),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None

def load_config():
    if not os.path.exists(CONFIG_FILE):
        save_config(DEFAULT_CONFIG)
        return dict(DEFAULT_CONFIG)
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception:
        return dict(DEFAULT_CONFIG)

    th = cfg.get("thresholds", [])
    if th and th[0] < 1.0:
        th = [max(1, int(t * 100)) for t in th]
        cfg["thresholds"] = th

    for k, v in DEFAULT_CONFIG.items():
        cfg.setdefault(k, v)

    mouth_count = cfg.get("mouth_count", 6)
    needed = max(1, mouth_count - 1)
    th = list(cfg.get("thresholds", []))
    while len(th) < needed:
        last = th[-1] if th else 1
        th.append(min(100, last + 5))
    cfg["thresholds"] = th[:needed]
    return cfg

def save_config(cfg):
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Не удалось сохранить config: {e}")