"""serverless 导出用例测试。"""

from __future__ import annotations

import io
import re

from PIL import Image

from api._lib.blob_repository import StoredBlob
from api._lib.contracts import SingleExportRequest, TileExportRequest
from api._lib.poster_export_service import PosterExportService, page_size_inch


class FakeBlobRepository:
    """用内存假仓储隔离导出业务测试。"""

    def __init__(self, source_bytes: bytes):
        self._source_bytes = source_bytes
        self.writes: list[tuple[str, bytes, str]] = []

    def read_private_bytes(self, url_or_path: str) -> bytes:
        return self._source_bytes

    def put_private_bytes(
        self,
        pathname: str,
        content: bytes,
        *,
        content_type: str,
    ) -> StoredBlob:
        self.writes.append((pathname, content, content_type))
        return StoredBlob(
            pathname=pathname,
            url=f"https://example.test/{pathname}",
            download_url=f"https://example.test/download/{pathname}",
        )


def make_png_bytes(size: tuple[int, int] = (320, 240)) -> bytes:
    """构造一张最小测试图。"""
    image = Image.new("RGB", size, color=(120, 80, 30))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def extract_media_box(pdf_bytes: bytes) -> tuple[float, float]:
    """从 PDF 字节中提取 MediaBox 宽高（单位：pt）。"""
    text = pdf_bytes.decode("latin-1", errors="ignore")
    match = re.search(
        r"/MediaBox\s*\[\s*0\s+0\s+([0-9.]+)\s+([0-9.]+)\s*\]",
        text,
    )
    if not match:
        raise AssertionError("PDF 中未找到 MediaBox")
    return float(match.group(1)), float(match.group(2))


def test_single_export_writes_pdf_blob() -> None:
    source = make_png_bytes()
    repo = FakeBlobRepository(source)
    service = PosterExportService(repo)

    prepared = service.export_single(
        SingleExportRequest(
            source_url="blob://source",
            source_name="poster.png",
            crop_x=10,
            crop_y=10,
            crop_w=180,
            crop_h=120,
            dpi=300,
            paper="a4",
            orientation="portrait",
        )
    )

    assert prepared.filename.endswith(".pdf")
    assert prepared.pathname.startswith("exports/")
    assert len(repo.writes) == 1
    path, content, content_type = repo.writes[0]
    assert path == prepared.pathname
    assert content_type == "application/pdf"
    assert content.startswith(b"%PDF")


def test_single_export_obeys_paper_size_and_dpi() -> None:
    source = make_png_bytes(size=(3200, 2400))
    repo = FakeBlobRepository(source)
    service = PosterExportService(repo)

    service.export_single(
        SingleExportRequest(
            source_url="blob://source",
            source_name="poster.png",
            crop_x=0,
            crop_y=0,
            crop_w=1600,
            crop_h=1200,
            dpi=300,
            paper="a4",
            orientation="portrait",
        )
    )

    _, content, _ = repo.writes[0]
    media_w, media_h = extract_media_box(content)
    expect_w = 8.27 * 72
    expect_h = 11.69 * 72
    assert abs(media_w - expect_w) < 0.2
    assert abs(media_h - expect_h) < 0.2


def test_single_export_orientation_changes_page_dimensions() -> None:
    source = make_png_bytes(size=(3200, 2400))
    repo = FakeBlobRepository(source)
    service = PosterExportService(repo)

    service.export_single(
        SingleExportRequest(
            source_url="blob://source",
            source_name="poster.png",
            crop_x=0,
            crop_y=0,
            crop_w=1600,
            crop_h=1200,
            dpi=300,
            paper="a4",
            orientation="landscape",
        )
    )

    _, content, _ = repo.writes[0]
    media_w, media_h = extract_media_box(content)
    assert media_w > media_h


def test_tile_export_writes_multi_page_pdf_blob() -> None:
    source = make_png_bytes(size=(800, 600))
    repo = FakeBlobRepository(source)
    service = PosterExportService(repo)

    prepared = service.export_tiles(
        TileExportRequest(
            source_url="blob://source",
            source_name="poster.png",
            cols=2,
            rows=2,
            dpi=150,
            paper="a4",
            orientation="landscape",
            crop_x=0,
            crop_y=0,
            crop_w=800,
            crop_h=600,
        )
    )

    assert prepared.filename.endswith(".pdf")
    assert prepared.pathname.startswith("exports/")
    assert len(repo.writes) == 1
    _, content, content_type = repo.writes[0]
    assert content_type == "application/pdf"
    assert content.startswith(b"%PDF")


def test_page_size_inch_rejects_unknown_paper() -> None:
    try:
        page_size_inch("a2", "portrait")
    except ValueError as exc:
        assert "不支持" in str(exc)
    else:
        raise AssertionError("未知纸张应抛出异常")
