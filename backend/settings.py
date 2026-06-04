import json
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

_SETTINGS_PATH = Path(__file__).parent.parent / "settings.json"
_DEFAULT_MODEL = "claude-haiku-4-5-20251001"


def _load_model() -> str:
    try:
        data = json.loads(_SETTINGS_PATH.read_text())
        return data.get("model", _DEFAULT_MODEL)
    except (FileNotFoundError, json.JSONDecodeError):
        return _DEFAULT_MODEL


_MODEL = _load_model()


def get_model() -> str:
    return _MODEL


def get_database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL environment variable is not set")
    return url


def get_jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET")
    if not secret:
        raise RuntimeError("JWT_SECRET environment variable is not set")
    return secret


def get_jwt_expire_minutes() -> int:
    return int(os.getenv("JWT_EXPIRE_MINUTES", "10080"))
