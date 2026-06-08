from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
FRONTEND_DIR = ROOT_DIR / "frontend"
UPLOAD_DIR = ROOT_DIR / "uploads"
DB_FILE = DATA_DIR / "library.db"

APP_NAME = "Smart Library Management System"
APP_VERSION = "1.0.0"
TOKEN_EXPIRE_SECONDS = 60 * 60 * 8
SECRET_KEY = "library-system-demo-secret-change-me"

# 确保目录存在
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
