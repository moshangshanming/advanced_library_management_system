@echo off
chcp 65001 >nul
cd /d %~dp0
if not exist .venv (
    echo [1/4] Creating virtual environment...
    python -m venv .venv
)
call "%~dp0.venv\Scripts\activate"
if errorlevel 1 (
    echo 无法激活虚拟环境，请确认 Python 已安装并可用。
    pause
    exit /b 1
)
echo [2/4] Installing dependencies...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if not exist data mkdir data
echo [4/4] Starting Library Management System...
echo Browser URL: http://127.0.0.1:8000
python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
pause
