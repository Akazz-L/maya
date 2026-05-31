import json
from pathlib import Path

_SETTINGS_PATH = Path(__file__).parent.parent / "settings.json"
_DEFAULT_MODEL = "claude-haiku-4-5-20251001"


def get_model() -> str:
    try:
        data = json.loads(_SETTINGS_PATH.read_text())
        return data.get("model", _DEFAULT_MODEL)
    except (FileNotFoundError, json.JSONDecodeError):
        return _DEFAULT_MODEL
