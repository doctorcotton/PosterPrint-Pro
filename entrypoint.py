#!/usr/bin/env python3
"""
Docker 容器启动脚本
- 发送服务启动通知到飞书
- 启动 gunicorn 服务
"""
import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime

# 飞书 Webhook 地址
WEBHOOK_URL = "https://k11pnjpvz1.feishu.cn/base/workflow/webhook/event/IGolaXSBbwNnxsh5FSOc9K82njh"

# 服务配置
SERVICE_NAME = "海报裁剪打印工具"
PORT = 15234


def get_host_ip():
    """获取宿主机 IP（从环境变量）"""
    return os.environ.get("HOST_IP", "unknown")


def send_feishu_notification():
    """发送启动通知到飞书"""
    host_ip = get_host_ip()
    service_url = f"http://{host_ip}:{PORT}"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    payload = {
        "service_name": SERVICE_NAME,
        "service_url": service_url,
        "host_ip": host_ip,
        "port": PORT,
        "start_time": timestamp,
        "status": "started"
    }

    print("正在发送服务启动通知到飞书...")
    print(f"  服务名称: {SERVICE_NAME}")
    print(f"  访问地址: {service_url}")

    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            WEBHOOK_URL,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"  飞书通知发送成功: {resp.status}")
    except Exception as e:
        print(f"  飞书通知发送失败: {e}")
        print("  服务仍将继续启动...")

    print()
    print("=" * 40)
    print(f"  {SERVICE_NAME} 已启动")
    print(f"  访问地址: {service_url}")
    print("=" * 40)
    print()


def start_gunicorn():
    """启动 gunicorn 服务"""
    cmd = [
        "gunicorn",
        "--bind", "0.0.0.0:5000",
        "--workers", "2",
        "--threads", "4",
        "crop_server:app"
    ]
    # 使用 exec 替换当前进程
    os.execvp("gunicorn", cmd)


if __name__ == "__main__":
    send_feishu_notification()
    start_gunicorn()

