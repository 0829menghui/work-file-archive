import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
STORAGE_DIR = DATA_DIR / "storage"
FILES_DIR = STORAGE_DIR / "files"
PREVIEWS_DIR = STORAGE_DIR / "previews"
DB_PATH = DATA_DIR / "work_file_archive.db"

APP_NAME = "个人模块化工作台"
DEFAULT_ADMIN_USERNAME = os.getenv("DEFAULT_ADMIN_USERNAME", "admin")
DEFAULT_ADMIN_PASSWORD = os.getenv("DEFAULT_ADMIN_PASSWORD", "admin123")
SESSION_EXPIRE_HOURS = int(os.getenv("SESSION_EXPIRE_HOURS", str(24 * 7)))

ALLOWED_DANGEROUS_EXTENSIONS = {
    "exe",
    "bat",
    "cmd",
    "sh",
    "msi",
    "dmg",
    "app",
    "scr",
    "com",
    "jar",
}
