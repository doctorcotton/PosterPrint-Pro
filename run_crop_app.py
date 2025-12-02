#!/usr/bin/env python3
"""
一键启动大图裁剪/分页小工具：

- 自动检查并安装依赖：flask、pillow
- 启动本地 Web 服务（使用 crop_server.py 中的 app）
- 自动在默认浏览器中打开页面

使用方式：

    python3 run_crop_app.py

只要系统里有 Python 3，就可以通过 pip 自动补齐依赖。
"""

import importlib
import subprocess
import sys
import threading
import time
import webbrowser


REQUIRED_PACKAGES = ["flask", "pillow"]


def ensure_packages():
    """检查并安装所需第三方包。"""
    missing = []
    for pkg in REQUIRED_PACKAGES:
        try:
            importlib.import_module(pkg)
        except ImportError:
            missing.append(pkg)

    if not missing:
        return

    print("检测到缺少依赖，将使用 pip 自动安装：", ", ".join(missing))
    cmd = [sys.executable, "-m", "pip", "install"] + missing
    print("执行命令：", " ".join(cmd))
    res = subprocess.run(cmd)
    if res.returncode != 0:
        print("自动安装依赖失败，请手动执行：")
        print("  ", " ".join(cmd))
        sys.exit(1)


def open_browser_later(url: str, delay: float = 1.5):
    """稍等一会自动打开浏览器，避免服务器还没启动好。"""
    def _open():
        time.sleep(delay)
        try:
            webbrowser.open(url)
        except Exception:
            pass

    t = threading.Thread(target=_open, daemon=True)
    t.start()


def main():
    ensure_packages()

    # 依赖准备好后再导入 Flask app
    from crop_server import app

    url = "http://127.0.0.1:5000/"
    print(f"本地服务即将启动，稍后会自动在浏览器中打开：{url}")
    open_browser_later(url)

    # 关闭 debug，避免多进程重复打开浏览器
    app.run(host="127.0.0.1", port=5000, debug=False)


if __name__ == "__main__":
    main()


