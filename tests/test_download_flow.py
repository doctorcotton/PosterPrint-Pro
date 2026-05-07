"""导出 / 下载两阶段接口的端到端测试。"""
import io
import hashlib
import os
import shutil
import time
from pathlib import Path
from urllib.parse import quote

import pytest
from PIL import Image

from crop_server import (
    _DOWNLOAD_ROOT,
    _TOKEN_RE,
    _cleanup_expired,
    app,
    debug_version_info,
)


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _tiny_png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (10, 10), color=(255, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


def test_export_prepare_creates_pdf_and_returns_token(client):
    data = {
        "crop_x": "0",
        "crop_y": "0",
        "crop_w": "10",
        "crop_h": "10",
        "dpi": "72",
        "paper": "a4",
        "orientation": "portrait",
    }
    files = {"image": (io.BytesIO(_tiny_png_bytes()), "test.png")}
    resp = client.post("/export_prepare", data={**data, **files})
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload is not None
    token = payload["token"]
    filename = payload["filename"]
    assert _TOKEN_RE.fullmatch(token)
    assert filename.endswith(".pdf")

    token_dir = _DOWNLOAD_ROOT / token
    pdf_path = token_dir / filename
    assert pdf_path.is_file()
    assert pdf_path.read_bytes()[:4] == b"%PDF"


def test_tile_export_prepare_creates_pdf_and_returns_token(client):
    data = {
        "cols": "1",
        "rows": "1",
        "dpi": "72",
        "orientation": "portrait",
        "paper": "a4",
        "crop_x": "0",
        "crop_y": "0",
        "crop_w": "10",
        "crop_h": "10",
    }
    files = {"image": (io.BytesIO(_tiny_png_bytes()), "test.png")}
    resp = client.post("/tile_export_prepare", data={**data, **files})
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload is not None
    token = payload["token"]
    filename = payload["filename"]
    assert _TOKEN_RE.fullmatch(token)
    assert filename.endswith(".pdf")
    assert (_DOWNLOAD_ROOT / token / filename).is_file()


def test_download_returns_pdf_and_cleans_up(client):
    data = {
        "crop_x": "0",
        "crop_y": "0",
        "crop_w": "10",
        "crop_h": "10",
        "dpi": "72",
        "paper": "a4",
        "orientation": "portrait",
    }
    files = {"image": (io.BytesIO(_tiny_png_bytes()), "x.png")}
    prep = client.post("/export_prepare", data={**data, **files})
    assert prep.status_code == 200
    p = prep.get_json()
    token, filename = p["token"], p["filename"]

    dl = client.get(f"/download/{token}/{filename}")
    assert dl.status_code == 200
    assert dl.mimetype == "application/pdf"
    assert "attachment" in (dl.headers.get("Content-Disposition") or "")
    assert dl.headers.get("Cache-Control") == "no-store, max-age=0"
    assert dl.headers.get("X-Content-Type-Options") == "nosniff"
    # 必须读完响应体，测试客户端才会关闭响应并触发 ``call_on_close``。
    body = dl.get_data()
    assert body[:4] == b"%PDF"

    assert not (_DOWNLOAD_ROOT / token).exists()


def test_head_before_get_does_not_delete_token_dir(client):
    """HEAD 不得触发生成器 finally；否则 Gunicorn 下先于 GET 删掉文件会 404。"""
    data = {
        "crop_x": "0",
        "crop_y": "0",
        "crop_w": "10",
        "crop_h": "10",
        "dpi": "72",
        "paper": "a4",
        "orientation": "portrait",
    }
    files = {"image": (io.BytesIO(_tiny_png_bytes()), "probe.png")}
    prep = client.post("/export_prepare", data={**data, **files})
    assert prep.status_code == 200
    p = prep.get_json()
    token, filename = p["token"], p["filename"]
    url = f"/download/{token}/{filename}"

    head = client.head(url)
    assert head.status_code == 200
    assert head.data == b""
    cl = head.headers.get("Content-Length")
    assert cl is not None and int(cl) > 0
    assert head.mimetype == "application/pdf"
    assert (_DOWNLOAD_ROOT / token).is_dir()
    assert (_DOWNLOAD_ROOT / token / filename).is_file()

    dl = client.get(url)
    assert dl.status_code == 200
    body = dl.get_data()
    assert len(body) == int(cl)
    assert body[:4] == b"%PDF"
    assert not (_DOWNLOAD_ROOT / token).exists()


def test_interrupted_get_keeps_token_dir_for_retry(client):
    """WSGI close() 会向生成器抛 GeneratorExit；中断下载时不能删除待重试文件。"""
    _DOWNLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    token = "partial-close-token"
    filename = "partial.pdf"
    token_dir = _DOWNLOAD_ROOT / token
    if token_dir.exists():
        shutil.rmtree(token_dir)
    token_dir.mkdir(parents=True)
    pdf_path = token_dir / filename
    pdf_path.write_bytes(b"%PDF\n" + b"a" * (160 * 1024))
    expected_size = pdf_path.stat().st_size

    try:
        resp = client.get(f"/download/{token}/{filename}", buffered=False)
        assert resp.status_code == 200
        first_chunk = next(iter(resp.response))
        assert first_chunk.startswith(b"%PDF")
        resp.close()

        assert token_dir.is_dir()
        assert pdf_path.is_file()

        retry = client.get(f"/download/{token}/{filename}")
        assert retry.status_code == 200
        body = retry.get_data()
        assert body.startswith(b"%PDF")
        assert len(body) == expected_size
        assert not token_dir.exists()
    finally:
        if token_dir.exists():
            shutil.rmtree(token_dir)


def test_download_supports_non_ascii_filename_header(client):
    data = {
        "crop_x": "0",
        "crop_y": "0",
        "crop_w": "10",
        "crop_h": "10",
        "dpi": "72",
        "paper": "a4",
        "orientation": "portrait",
    }
    upload_name = "元气标签确认单200.09.15(大麦茶&).png"
    files = {"image": (io.BytesIO(_tiny_png_bytes()), upload_name)}
    prep = client.post("/export_prepare", data={**data, **files})
    assert prep.status_code == 200
    p = prep.get_json()
    token, filename = p["token"], p["filename"]
    assert filename.startswith("元气标签确认单")

    dl = client.get(f"/download/{token}/{quote(filename, safe='')}")
    assert dl.status_code == 200
    body = dl.get_data()
    assert body[:4] == b"%PDF"

    disposition = dl.headers.get("Content-Disposition") or ""
    disposition.encode("latin-1")
    assert disposition.startswith("attachment;")
    assert 'filename="' in disposition
    assert "filename*=UTF-8''" in disposition
    assert quote(filename, safe="") in disposition
    assert "元气标签确认单" not in disposition
    assert not (_DOWNLOAD_ROOT / token).exists()


def test_debug_version_reports_download_cleanup_policy(client):
    resp = client.get("/debug/version")
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload is not None
    assert payload == debug_version_info()
    assert payload["download_cleanup_policy"] == "cleanup-after-complete-stream-only"
    assert payload["head_download_branch"] is True
    assert isinstance(payload["source_sha256"], str)
    assert len(payload["source_sha256"]) == 64


def test_download_rejects_unknown_token(client):
    resp = client.get("/download/zzzzzzzzzzzzzzzzzzzz/missing.pdf")
    assert resp.status_code == 404


def test_download_rejects_malformed_token_length(client):
    # token 长度必须落在 16–64；15 个字母应直接 404。
    resp = client.get("/download/abcdefghijklmno/missing.pdf")
    assert resp.status_code == 404


def test_download_rejects_path_traversal_filename(client):
    resp = client.get("/download/zzzzzzzzzzzzzzzzzzzz/../../etc/passwd")
    assert resp.status_code == 404


def test_export_prepare_invalid_crop_returns_400(client):
    data = {
        "crop_x": "0",
        "crop_y": "0",
        "crop_w": "0",
        "crop_h": "10",
        "dpi": "72",
        "paper": "a4",
        "orientation": "portrait",
    }
    files = {"image": (io.BytesIO(_tiny_png_bytes()), "t.png")}
    resp = client.post("/export_prepare", data={**data, **files})
    assert resp.status_code == 400
    err = resp.get_json()
    assert err is not None and "error" in err


def test_cleanup_expired_removes_old_dirs():
    _DOWNLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    stale = _DOWNLOAD_ROOT / "stale_token_dir_for_test"
    if stale.exists():
        shutil.rmtree(stale)
    stale.mkdir(parents=True)
    old = time.time() - 7200
    os.utime(stale, (old, old))

    fresh = _DOWNLOAD_ROOT / "fresh_token_dir_for_test"
    if fresh.exists():
        shutil.rmtree(fresh)
    fresh.mkdir(parents=True)

    now = time.time()
    _cleanup_expired(now=now)

    assert not stale.exists()
    assert fresh.exists()
    shutil.rmtree(fresh)


def test_trust_info_reports_missing_root_ca(client, monkeypatch, tmp_path):
    missing = tmp_path / "missing-rootCA.pem"
    monkeypatch.setattr("crop_server._ROOT_CA_PATH", missing)
    monkeypatch.delenv("PUBLIC_URL", raising=False)

    resp = client.get("/trust/info.json")
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload is not None
    assert payload["root_ca_exists"] is False
    assert payload["sha256"] is None
    assert payload["download_url"] is None
    assert payload["recommended_https_url"] == ""

    cert = client.get("/trust/root-ca.pem")
    assert cert.status_code == 404


def test_trust_info_and_root_ca_download(client, monkeypatch, tmp_path):
    cert_path = tmp_path / "rootCA.pem"
    cert_bytes = b"-----BEGIN CERTIFICATE-----\ntest-root-ca\n-----END CERTIFICATE-----\n"
    cert_path.write_bytes(cert_bytes)
    monkeypatch.setattr("crop_server._ROOT_CA_PATH", cert_path)
    monkeypatch.setenv("PUBLIC_URL", "https://poster.local/")

    resp = client.get("/trust/info.json")
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload is not None
    assert payload["root_ca_exists"] is True
    assert payload["sha256"] == hashlib.sha256(cert_bytes).hexdigest()
    assert payload["download_url"] == "/trust/root-ca.pem"
    assert payload["recommended_https_url"] == "https://poster.local"

    cert = client.get("/trust/root-ca.pem")
    assert cert.status_code == 200
    assert cert.data == cert_bytes
    assert cert.mimetype == "application/x-pem-file"
    disposition = cert.headers.get("Content-Disposition") or ""
    assert "attachment" in disposition
    assert "root-ca.pem" in disposition
