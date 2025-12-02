@echo off
chcp 65001 >nul
title 大图裁剪/分页打印工具

echo.
echo ========================================
echo     大图裁剪/分页打印工具
echo ========================================
echo.

:: 检查 Python 是否安装
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Python！
    echo.
    echo 请先安装 Python 3.7 或更高版本：
    echo https://www.python.org/downloads/
    echo.
    echo 安装时请务必勾选「Add Python to PATH」选项！
    echo.
    pause
    exit /b 1
)

echo [√] 已检测到 Python
python --version
echo.

:: 运行启动脚本
echo 正在启动服务，请稍候...
echo 启动后会自动打开浏览器
echo.
echo 按 Ctrl+C 可停止服务
echo ----------------------------------------
echo.

python run_crop_app.py

if %errorlevel% neq 0 (
    echo.
    echo [错误] 启动失败，请检查错误信息
    pause
)

