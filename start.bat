@echo off
cd /d "%~dp0"

echo.
echo ========================================
echo     Poster Crop Tool - Starting...
echo ========================================
echo.

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python not found!
    echo.
    echo Download Python from:
    echo https://www.python.org/downloads/
    echo.
    echo Check "Add Python to PATH" when installing!
    echo.
    pause
    exit /b 1
)

echo Python OK
python --version
echo.
echo Starting server, browser will open soon...
echo Press Ctrl+C to stop
echo.

python run_crop_app.py

echo.
echo ========================================
echo Server stopped. Press any key to close.
pause >nul

