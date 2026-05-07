#!/usr/bin/env python3
"""
Docker 容器启动脚本
- 打印局域网访问提示（探测 IPv4、读取可选环境变量）
- 发送服务启动通知到飞书
- 启动 gunicorn 服务
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import traceback
import urllib.request
from datetime import datetime
from pathlib import Path

# 飞书 Webhook 地址
WEBHOOK_URL = "https://k11pnjpvz1.feishu.cn/base/workflow/webhook/event/IGolaXSBbwNnxsh5FSOc9K82njh"

# 服务配置
SERVICE_NAME = "海报裁剪打印工具"
# docker-compose 映射：宿主 15234/15235 -> 容器 5000/5443。
HTTP_CONTAINER_PORT = 5000
HTTPS_CONTAINER_PORT = 5443
HTTP_PUBLIC_PORT = 15234
HTTPS_PUBLIC_PORT = 15235
HTTP_URL_SCHEME = "http://{host}:" + str(HTTP_PUBLIC_PORT)
HTTPS_URL_SCHEME = "https://{host}:" + str(HTTPS_PUBLIC_PORT)

DEFAULT_CERT_FILE = Path("/app/certs/server.crt")
DEFAULT_KEY_FILE = Path("/app/certs/server.key")
GENERATED_TLS_DIR = Path("/tmp/poster_crop_tls")
GENERATED_CERT_FILE = GENERATED_TLS_DIR / "server.crt"
GENERATED_KEY_FILE = GENERATED_TLS_DIR / "server.key"


def _runtime_version_info() -> dict[str, object]:
    """读取后端运行版本；失败时返回显式错误，方便从 Docker 日志定位。"""
    try:
        from crop_server import debug_version_info

        return debug_version_info()
    except Exception as e:
        return {"version_error": repr(e)}


def _default_ipv4_via_udp() -> str | None:
    """通过 UDP connect 取默认路由对应的本地 IPv4（不发真实业务包）。"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.settimeout(0.3)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            return ip if isinstance(ip, str) else None
        finally:
            s.close()
    except OSError:
        return None


def _non_loopback_ipv4_list() -> list[str]:
    """列出 ``gethostname`` 解析到的非 127 IPv4（容器内多为 bridge 网段）。"""
    try:
        _, _, ipaddrs = socket.gethostbyname_ex(socket.gethostname())
    except OSError:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for ip in ipaddrs:
        if ip.startswith("127.") or ip in seen:
            continue
        seen.add(ip)
        out.append(ip)
    return out


def _local_https_hosts() -> list[str]:
    """返回生成自签证书时应覆盖的本机访问名。"""
    candidates = [
        "localhost",
        "127.0.0.1",
        (os.environ.get("HOST_IP") or "").strip(),
        _default_ipv4_via_udp() or "",
        *_non_loopback_ipv4_list(),
    ]
    out: list[str] = []
    seen: set[str] = set()
    for host in candidates:
        if not host or host in seen:
            continue
        seen.add(host)
        out.append(host)
    return out


def _openssl_san_arg(hosts: list[str]) -> str:
    parts: list[str] = []
    for host in hosts:
        if all(part.isdigit() and 0 <= int(part) <= 255 for part in host.split(".")):
            parts.append(f"IP:{host}")
        else:
            parts.append(f"DNS:{host}")
    return "subjectAltName=" + ",".join(parts)


def _ensure_tls_cert() -> tuple[Path, Path] | None:
    """优先使用挂载证书；否则用 openssl 生成临时自签证书。"""
    env_cert = Path(os.environ["SSL_CERT_FILE"]) if os.environ.get("SSL_CERT_FILE") else None
    env_key = Path(os.environ["SSL_KEY_FILE"]) if os.environ.get("SSL_KEY_FILE") else None
    if env_cert and env_key and env_cert.is_file() and env_key.is_file():
        return env_cert, env_key
    if DEFAULT_CERT_FILE.is_file() and DEFAULT_KEY_FILE.is_file():
        return DEFAULT_CERT_FILE, DEFAULT_KEY_FILE

    hosts = _local_https_hosts()
    GENERATED_TLS_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [
        "openssl",
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-days",
        "30",
        "-nodes",
        "-keyout",
        str(GENERATED_KEY_FILE),
        "-out",
        str(GENERATED_CERT_FILE),
        "-subj",
        f"/CN={hosts[0] if hosts else 'localhost'}",
        "-addext",
        _openssl_san_arg(hosts or ["localhost", "127.0.0.1"]),
    ]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    except Exception as e:
        print(f"  HTTPS 证书生成失败: {e}")
        print("  将仅启动 HTTP；Chrome 可能继续拦截局域网下载。")
        return None
    return GENERATED_CERT_FILE, GENERATED_KEY_FILE


def https_url_for_host(host: str) -> str:
    return HTTPS_URL_SCHEME.format(host=host)


def http_url_for_host(host: str) -> str:
    return HTTP_URL_SCHEME.format(host=host)


def print_access_banner() -> None:
    """启动时在控制台打印可达地址线索（不把静默异常当作成功）。"""
    env_host = (os.environ.get("HOST_IP") or "").strip()
    public_url = (os.environ.get("PUBLIC_URL") or "").strip()
    version_info = _runtime_version_info()

    print()
    print("=" * 52)
    print(f"  {SERVICE_NAME} · 局域网访问提示")
    print("=" * 52)
    print(f"  后端版本: {version_info.get('app_version', 'unknown')}")
    print(f"  下载清理策略: {version_info.get('download_cleanup_policy', 'unknown')}")
    source_sha = str(version_info.get("source_sha256", "unknown"))
    print(f"  crop_server.py SHA256: {source_sha[:16]}")
    print(f"  版本接口: /debug/version")
    if public_url:
        print(f"  PUBLIC_URL（可选）: {public_url}")
    if env_host:
        print(f"  HOST_IP（环境变量）: {env_host}")
        print(f"    → HTTP  {http_url_for_host(env_host)}")
        print(f"    → HTTPS {https_url_for_host(env_host)}")
    route_ip = _default_ipv4_via_udp()
    if route_ip:
        print(f"  默认路由本地 IPv4（容器内）: {route_ip}")
        print(f"    → HTTP  {http_url_for_host(route_ip)}")
        print(f"    → HTTPS {https_url_for_host(route_ip)}")
    for ip in _non_loopback_ipv4_list():
        print(f"  主机名解析 IPv4: HTTP {http_url_for_host(ip)} / HTTPS {https_url_for_host(ip)}")
    print()
    print("  下载提示：Chrome 若拦截 HTTP 下载，请使用 HTTPS 地址或让前端跳到 HTTPS 下载端口。")
    print("  说明：局域网其他设备请使用「运行 Docker 的宿主机」在局域网中的 IP；")
    print("  容器内 172.x 等地址通常只在 Docker 网络内可达。")
    print("=" * 52)
    print()


def service_url_for_notification() -> str:
    """飞书通知里的访问地址：优先 HTTPS + HOST_IP，其次 HTTPS + UDP 探测 IP。"""
    public_url = (os.environ.get("PUBLIC_URL") or "").strip()
    if public_url:
        return public_url.rstrip("/")
    env_host = (os.environ.get("HOST_IP") or "").strip()
    if env_host:
        return https_url_for_host(env_host)
    route_ip = _default_ipv4_via_udp()
    if route_ip:
        return https_url_for_host(route_ip)
    return f"https://unknown:{HTTPS_PUBLIC_PORT}"


def send_feishu_notification():
    """发送启动通知到飞书"""
    host_ip = (os.environ.get("HOST_IP") or "").strip() or _default_ipv4_via_udp() or "unknown"
    service_url = service_url_for_notification()
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    version_info = _runtime_version_info()

    payload = {
        "service_name": SERVICE_NAME,
        "service_url": service_url,
        "host_ip": host_ip,
        "port": HTTPS_PUBLIC_PORT,
        "start_time": timestamp,
        "status": "started",
        "app_version": version_info.get("app_version"),
        "source_sha256": version_info.get("source_sha256"),
        "download_cleanup_policy": version_info.get("download_cleanup_policy"),
    }

    print("正在发送服务启动通知到飞书...")
    print(f"  服务名称: {SERVICE_NAME}")
    print(f"  访问地址: {service_url}")
    print(f"  后端版本: {version_info.get('app_version', 'unknown')}")

    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            WEBHOOK_URL,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"  飞书通知发送成功: {resp.status}")
    except Exception as e:
        print(f"  飞书通知发送失败: {e}")
        tb_lines = traceback.format_exc().splitlines()
        if tb_lines:
            print(f"  根因末行: {tb_lines[-1]}")
        print("  服务仍将继续启动...")

    print()
    print("=" * 40)
    print(f"  {SERVICE_NAME} 已启动")
    print(f"  访问地址: {service_url}")
    print("=" * 40)
    print()


def _gunicorn_base_cmd(bind: str) -> list[str]:
    return [
        "gunicorn",
        "--bind",
        bind,
        "--workers",
        "2",
        "--threads",
        "4",
    ]


def start_gunicorn():
    """同时启动 HTTP 与 HTTPS；主进程使用 HTTPS，HTTP 作为兼容入口。"""
    tls = _ensure_tls_cert()
    http_cmd = [*_gunicorn_base_cmd(f"0.0.0.0:{HTTP_CONTAINER_PORT}"), "crop_server:app"]

    if not tls:
        os.execvp("gunicorn", http_cmd)

    cert_file, key_file = tls
    print(f"HTTPS 已启用: cert={cert_file} key={key_file}")
    subprocess.Popen(http_cmd)

    https_cmd = [
        *_gunicorn_base_cmd(f"0.0.0.0:{HTTPS_CONTAINER_PORT}"),
        "--certfile",
        str(cert_file),
        "--keyfile",
        str(key_file),
        "crop_server:app",
    ]
    os.execvp("gunicorn", https_cmd)


if __name__ == "__main__":
    print_access_banner()
    send_feishu_notification()
    start_gunicorn()
