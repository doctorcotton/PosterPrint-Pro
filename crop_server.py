#!/usr/bin/env python3
"""海报裁剪打印工具的 Flask 后端。

下载流程拆为两段：
1. POST /export_prepare、/tile_export_prepare：生成 PDF，写入
   ``_DOWNLOAD_ROOT/<token>/<filename>`` 并返回 ``{"token", "filename"}``。
2. GET /download/<token>/<filename>：浏览器以原生方式下载，完整传输后清理。
   HEAD 仅返回元数据（含 Content-Length），不得使用流式生成器：否则 WSGI 对 HEAD
   不迭代响应体但会 close() iterable，会误触生成器 finally 提前删掉待下载文件。
   GET 若被客户端中断，也不能删除文件；用户可在 TTL 内重试同一下载链接。

之所以拆开，是因为 Chrome 117+ 在 HTTP 非安全上下文下会拦截 ``blob:`` URL 触发
的下载（控制台出现 ``loaded over an insecure connection``）。改成同源 GET 后，
``Content-Disposition: attachment`` 走浏览器的下载子系统，不再受该限制。
"""
from __future__ import annotations
import os
import re
import secrets
import shutil
import tempfile
import time
import hashlib
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from flask import Flask, Response, abort, jsonify, request, send_from_directory
from PIL import Image

app = Flask(__name__)

_APP_VERSION = "download-cleanup-https-v3-20260507"
_DOWNLOAD_CLEANUP_POLICY = "cleanup-after-complete-stream-only"

# ISO 216，单位：英寸（竖版：宽 × 高）
A4_WIDTH_INCH = 8.27
A4_HEIGHT_INCH = 11.69
A3_WIDTH_INCH = 11.69
A3_HEIGHT_INCH = 16.54

# 待下载的 PDF 临时存储根目录。每个 token 一个子目录，下载完毕即整目录删除。
# 放在系统临时目录下，多 worker（gunicorn）通过共享文件系统通信，无需外部依赖。
_DOWNLOAD_ROOT = Path(tempfile.gettempdir()) / "poster_downloads"

# mkcert 根证书分发入口。证书本身不是秘密，私钥不要放进该目录或提交到仓库。
_CERTS_DIR = Path(__file__).resolve().parent / "certs"
_ROOT_CA_PATH = _CERTS_DIR / "rootCA.pem"

# 单个 token 目录的最长存活时间（秒）。超过这个时间未被下载会被周期清理。
_TOKEN_TTL_SECONDS = 30 * 60

# token 必须是 url-safe 的纯字符，长度区间用于阻断路径遍历或畸形输入。
_TOKEN_RE = re.compile(r"\A[A-Za-z0-9_-]{16,64}\Z")


def page_size_inch(paper: str, orientation: str) -> tuple[float, float]:
    """返回单页 PDF 的页面尺寸 (宽英寸, 高英寸)。

    paper: a4 | a3；orientation: portrait | landscape。
    """
    paper_n = (paper or "a4").lower().strip()
    orient_n = (orientation or "portrait").lower().strip()
    if paper_n == "a3":
        w0, h0 = A3_WIDTH_INCH, A3_HEIGHT_INCH
    elif paper_n == "a4":
        w0, h0 = A4_WIDTH_INCH, A4_HEIGHT_INCH
    else:
        raise ValueError(f"不支持的纸张规格: {paper!r}，仅支持 a4、a3")
    if orient_n == "landscape":
        return h0, w0
    if orient_n == "portrait":
        return w0, h0
    raise ValueError(f"不支持的纸张方向: {orientation!r}，仅支持 portrait、landscape")


def _ensure_root() -> Path:
    """确保 ``_DOWNLOAD_ROOT`` 存在并返回。"""
    _DOWNLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    return _DOWNLOAD_ROOT


def _cleanup_expired(now: float | None = None) -> None:
    """清理 ``_DOWNLOAD_ROOT`` 下早于 ``_TOKEN_TTL_SECONDS`` 的子目录。

    单一职责：扫描+删除。任何 IO 异常都直接抛给调用方（避免静默吞错），
    由请求处理装饰器统一进入 5xx。
    """
    root = _ensure_root()
    threshold = (now if now is not None else time.time()) - _TOKEN_TTL_SECONDS
    for entry in root.iterdir():
        if not entry.is_dir():
            continue
        if entry.stat().st_mtime < threshold:
            shutil.rmtree(entry)


def _make_token() -> str:
    """生成一次性 token。``secrets.token_urlsafe(16)`` 给 22 字符的 url-safe 串。"""
    return secrets.token_urlsafe(16)


def _allocate_token_dir() -> tuple[str, Path]:
    """新建一个 ``_DOWNLOAD_ROOT/<token>`` 目录并返回 (token, 目录)。"""
    _ensure_root()
    token = _make_token()
    token_dir = _DOWNLOAD_ROOT / token
    # 极小概率撞名，``mkdir(exist_ok=False)`` 会直接 FileExistsError，符合不静默原则。
    token_dir.mkdir(parents=True, exist_ok=False)
    return token, token_dir


def _resolve_download_path(token: str, filename: str) -> Path:
    """把 (token, filename) 解析成实际文件路径，路径不合法或越界则 404。

    校验三层：token 字符集、filename 不含路径分隔符与 ``..``、``Path.resolve()``
    后的真实路径必须仍在 ``_DOWNLOAD_ROOT`` 之内。
    """
    if not _TOKEN_RE.fullmatch(token):
        abort(404)
    if not filename or "/" in filename or "\\" in filename:
        abort(404)
    if filename in {".", ".."}:
        abort(404)

    root_resolved = _ensure_root().resolve()
    candidate = (_DOWNLOAD_ROOT / token / filename).resolve()
    # 用 ``relative_to`` 兼容 Python 3.7+（``Path.is_relative_to`` 为 3.9+）。
    try:
        candidate.relative_to(root_resolved)
    except ValueError:
        abort(404)
    if not candidate.is_file():
        abort(404)
    return candidate


def _content_disposition_attachment(filename: str) -> str:
    """生成兼容中文文件名的 ``Content-Disposition`` 响应头。

    WSGI/HTTP 响应头必须能以 Latin-1 编码；中文原名放进 RFC 5987 的
    ``filename*``，普通 ``filename`` 只作为 ASCII fallback。
    """
    fallback = "".join(
        ch for ch in filename if 32 <= ord(ch) <= 126 and ch not in {'"', "\\"}
    ).strip()
    if not fallback or fallback in {".", ".."}:
        fallback = "download.pdf"
    encoded = quote(filename, safe="")
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"


def _sha256_file(path: Path) -> str:
    """返回文件的 SHA-256 十六进制指纹。"""
    digest = hashlib.sha256()
    with path.open("rb") as fp:
        while True:
            chunk = fp.read(64 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def debug_version_info() -> dict[str, object]:
    """返回运行中代码的可核验版本信息，便于排查容器是否仍在跑旧镜像。"""
    source_path = Path(__file__).resolve()
    return {
        "app_version": _APP_VERSION,
        "source_path": str(source_path),
        "source_sha256": _sha256_file(source_path),
        "download_cleanup_policy": _DOWNLOAD_CLEANUP_POLICY,
        "head_download_branch": True,
        "token_ttl_seconds": _TOKEN_TTL_SECONDS,
    }


def _recommended_public_url() -> str:
    """返回给 ``/trust/info.json`` 的可选公网/反代基址；未设置时返回空串（不再默认 poster.local）。"""
    public_url = (os.environ.get("PUBLIC_URL") or "").strip()
    return public_url.rstrip("/") if public_url else ""


@app.route("/debug/version", methods=["GET"])
def debug_version():
    """返回运行中后端代码版本信息，用于 Docker 镜像排查。"""
    return jsonify(debug_version_info())


@app.route("/trust/info.json", methods=["GET"])
def trust_info():
    """返回 mkcert 根证书分发信息，不包含私钥。"""
    root_ca_exists = _ROOT_CA_PATH.is_file()
    fingerprint = _sha256_file(_ROOT_CA_PATH) if root_ca_exists else None
    return jsonify(
        {
            "root_ca_exists": root_ca_exists,
            "sha256": fingerprint,
            "download_url": "/trust/root-ca.pem" if root_ca_exists else None,
            "recommended_https_url": _recommended_public_url(),
            "current_is_https": request.scheme == "https",
        }
    )


@app.route("/trust/root-ca.pem", methods=["GET"])
def download_root_ca():
    """下载 mkcert 根证书。客户端仍需手动安装并信任。"""
    if not _ROOT_CA_PATH.is_file():
        return jsonify({"error": "管理员尚未配置 certs/rootCA.pem"}), 404
    data = _ROOT_CA_PATH.read_bytes()
    return Response(
        data,
        mimetype="application/x-pem-file",
        headers={"Content-Disposition": _content_disposition_attachment("root-ca.pem")},
    )


@app.route("/")
def index():
    """构建后的前端页面（``npm run build`` 生成 ``dist/crop.html``）。"""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    dist_dir = os.path.join(base_dir, "dist")
    return send_from_directory(dist_dir, "crop.html")


@app.route("/export_prepare", methods=["POST"])
def export_prepare():
    """生成单页裁剪 PDF，落到 token 目录，返回 ``{token, filename}``。"""
    if "image" not in request.files:
        return jsonify({"error": "缺少图片文件"}), 400

    f = request.files["image"]
    if f.filename == "":
        return jsonify({"error": "文件名为空"}), 400

    try:
        crop_x = int(float(request.form.get("crop_x", "0")))
        crop_y = int(float(request.form.get("crop_y", "0")))
        crop_w = int(float(request.form.get("crop_w", "0")))
        crop_h = int(float(request.form.get("crop_h", "0")))
        dpi = int(float(request.form.get("dpi", "300")))
    except ValueError:
        return jsonify({"error": "裁剪参数或 DPI 不合法"}), 400

    paper = request.form.get("paper") or "a4"
    try:
        page_size_inch(paper, request.form.get("orientation") or "portrait")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    if crop_w <= 0 or crop_h <= 0:
        return jsonify({"error": "裁剪宽高必须大于 0"}), 400

    _cleanup_expired()
    token, token_dir = _allocate_token_dir()
    img_path = token_dir / f"src_{f.filename}"
    f.save(img_path)

    with Image.open(img_path) as im:
        width, height = im.size
        x1 = max(0, min(crop_x, width))
        y1 = max(0, min(crop_y, height))
        x2 = max(0, min(crop_x + crop_w, width))
        y2 = max(0, min(crop_y + crop_h, height))
        if x2 <= x1 or y2 <= y1:
            # 裁剪区域无效就不留垃圾目录。
            shutil.rmtree(token_dir)
            return jsonify({"error": "裁剪区域无效"}), 400

        cropped = im.crop((x1, y1, x2, y2))
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        base_name = os.path.splitext(os.path.basename(f.filename))[0]
        paper_tag = (paper or "a4").lower().strip()
        out_name = f"{base_name}_view_{paper_tag}_{ts}.pdf"
        out_path = token_dir / out_name
        # ``resolution`` 控制 PDF 中的 DPI。
        cropped.save(out_path, "PDF", resolution=dpi)

    # 删掉源图，token 目录里只留 PDF，避免下载接口意外把源图发出去。
    img_path.unlink()
    return jsonify({"token": token, "filename": out_name})


@app.route("/tile_export_prepare", methods=["POST"])
def tile_export_prepare():
    """生成多页拼接 PDF，落到 token 目录，返回 ``{token, filename}``。"""
    if "image" not in request.files:
        return jsonify({"error": "缺少图片文件"}), 400

    f = request.files["image"]
    if f.filename == "":
        return jsonify({"error": "文件名为空"}), 400

    try:
        cols = int(float(request.form.get("cols", "2")))
        rows = int(float(request.form.get("rows", "2")))
        dpi = int(float(request.form.get("dpi", "300")))
        crop_x = request.form.get("crop_x")
        crop_y = request.form.get("crop_y")
        crop_w = request.form.get("crop_w")
        crop_h = request.form.get("crop_h")
        has_crop = (
            crop_x is not None
            and crop_y is not None
            and crop_w is not None
            and crop_h is not None
        )
        if has_crop:
            crop_x = int(float(crop_x))
            crop_y = int(float(crop_y))
            crop_w = int(float(crop_w))
            crop_h = int(float(crop_h))
    except ValueError:
        return jsonify({"error": "分页参数不合法"}), 400

    orientation = (request.form.get("orientation", "portrait") or "portrait").lower()
    paper = request.form.get("paper") or "a4"
    try:
        page_w_inch, page_h_inch = page_size_inch(paper, orientation)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    cols = max(1, cols)
    rows = max(1, rows)
    dpi = max(72, dpi)

    page_w_px = int(round(page_w_inch * dpi))
    page_h_px = int(round(page_h_inch * dpi))
    total_w = cols * page_w_px
    total_h = rows * page_h_px

    _cleanup_expired()
    token, token_dir = _allocate_token_dir()
    img_path = token_dir / f"src_{f.filename}"
    f.save(img_path)

    with Image.open(img_path) as im:
        im = im.convert("RGB")
        src_w, src_h = im.size

        if has_crop:
            x1 = max(0, min(crop_x, src_w))
            y1 = max(0, min(crop_y, src_h))
            x2 = max(0, min(crop_x + crop_w, src_w))
            y2 = max(0, min(crop_y + crop_h, src_h))
            if x2 > x1 and y2 > y1:
                im = im.crop((x1, y1, x2, y2))
                src_w, src_h = im.size

        # 类似 CSS cover：按较大比例缩放并居中裁切，铺满整个 N×M 页面区域。
        scale = max(total_w / src_w, total_h / src_h)
        scaled_w = int(round(src_w * scale))
        scaled_h = int(round(src_h * scale))
        im_scaled = im.resize((scaled_w, scaled_h), Image.LANCZOS)

        left = max(0, (scaled_w - total_w) // 2)
        top = max(0, (scaled_h - total_h) // 2)
        right = left + total_w
        bottom = top + total_h
        im_fitted = im_scaled.crop((left, top, right, bottom))

        tiles = []
        for r in range(rows):
            for c in range(cols):
                x1 = c * page_w_px
                y1 = r * page_h_px
                x2 = x1 + page_w_px
                y2 = y1 + page_h_px
                tile = im_fitted.crop((x1, y1, x2, y2))
                tiles.append(tile)

        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        base_name = os.path.splitext(os.path.basename(f.filename))[0]
        paper_tag = paper.lower().strip()
        out_name = f"{base_name}_{paper_tag.upper()}_{cols}x{rows}_{ts}.pdf"
        out_path = token_dir / out_name

        first, *rest = tiles
        first.save(
            out_path,
            "PDF",
            resolution=dpi,
            save_all=True,
            append_images=rest,
        )

    img_path.unlink()
    return jsonify({"token": token, "filename": out_name})


@app.route("/download/<token>/<path:filename>", methods=["GET", "HEAD"])
def download_pdf(token: str, filename: str):
    """浏览器原生 GET 下载入口。响应体完整发送完毕后删除整个 token 目录。

    HEAD 必须单独返回空体：Gunicorn 等对 HEAD 不消费 body 但会 close() 可迭代响应，
    若与 GET 共用流式生成器，``finally`` 会在真正的 GET 之前执行并 404。

    GET 的生成器不能用 ``finally`` 清理：客户端断开或浏览器取消下载时 WSGI 会
    close() 生成器并触发 GeneratorExit，若此时删除目录，用户重试同一 URL 会 404。
    """
    pdf_path = _resolve_download_path(token, filename)
    token_dir = pdf_path.parent

    if request.method == "HEAD":
        length = pdf_path.stat().st_size
        # 空 body 时 Werkzeug 会把 Content-Length 算成 0，必须显式设为文件大小（与 GET 一致）。
        head_resp = Response(
            "",
            mimetype="application/pdf",
            headers={
                "Content-Disposition": _content_disposition_attachment(filename),
                "Cache-Control": "no-store, max-age=0",
                "X-Content-Type-Options": "nosniff",
            },
        )
        head_resp.content_length = length
        return head_resp

    def stream_pdf_then_cleanup():
        try:
            with pdf_path.open("rb") as fp:
                while True:
                    chunk = fp.read(64 * 1024)
                    if not chunk:
                        break
                    yield chunk
        except GeneratorExit:
            raise

        shutil.rmtree(token_dir, ignore_errors=True)

    return Response(
        stream_pdf_then_cleanup(),
        mimetype="application/pdf",
        headers={
            "Content-Disposition": _content_disposition_attachment(filename),
            "Cache-Control": "no-store, max-age=0",
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.route("/<path:filename>")
def static_files(filename):
    """优先提供 ``dist/`` 下资源（Vite 产物），否则回退项目根目录。"""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    dist_path = os.path.join(base_dir, "dist", filename)
    if os.path.isfile(dist_path):
        return send_from_directory(os.path.join(base_dir, "dist"), filename)
    root_path = os.path.join(base_dir, filename)
    if os.path.isfile(root_path):
        return send_from_directory(base_dir, filename)
    abort(404)


if __name__ == "__main__":
    # 默认本地开发使用
    app.run(host="127.0.0.1", port=5000, debug=True)
