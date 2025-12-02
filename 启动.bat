@echo off
setlocal enabledelayedexpansion

:: 切换到脚本所在目录
cd /d "%~dp0"

echo.
echo ========================================
echo     Poster Crop Tool
echo ========================================
echo.

:: 检查 Python 是否安装
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [Error] Python not found!
    echo.
    echo Please install Python 3.7+:
    echo https://www.python.org/downloads/
    echo.
    echo Remember to check "Add Python to PATH"!
    echo.
    pause
    exit /b 1
)

echo [OK] Python found:
python --version
echo.

:: 运行启动脚本
echo Starting server...
echo Browser will open automatically.
echo.
echo Press Ctrl+C to stop.
echo ----------------------------------------
echo.

python run_crop_app.py

:: 无论成功还是失败，都暂停等待用户确认
echo.
echo ----------------------------------------
if %errorlevel% neq 0 (
    echo [Error] Program exited with code: %errorlevel%
) else (
    echo Server stopped.
)
echo.
pause
