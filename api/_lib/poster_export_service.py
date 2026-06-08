"""海报导出用例：从源图生成 PDF，并写回 Blob。"""

from __future__ import annotations

import io
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import uuid4

from PIL import Image

from .blob_repository import StoredBlob
from .contracts import SingleExportRequest, TileExportRequest

# ISO 216，单位：英寸（竖版：宽 × 高）
A4_WIDTH_INCH = 8.27
A4_HEIGHT_INCH = 11.69
A3_WIDTH_INCH = 11.69
A3_HEIGHT_INCH = 16.54


class BlobWriter(Protocol):
    """导出用例依赖的最小 Blob 读写能力。"""

    def read_private_bytes(self, url_or_path: str) -> bytes:
        """读取私有 Blob。"""

    def put_private_bytes(
        self,
        pathname: str,
        content: bytes,
        *,
        content_type: str,
    ) -> StoredBlob:
        """写入私有 Blob。"""


@dataclass(frozen=True, slots=True)
class ExportPrepared:
    """导出完成后返回给边界层的结果。"""

    filename: str
    pathname: str


def page_size_inch(paper: str, orientation: str) -> tuple[float, float]:
    """返回单页 PDF 页面尺寸。"""
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


class PosterExportService:
    """导出业务编排。"""

    def __init__(self, blob_writer: BlobWriter):
        self._blob_writer = blob_writer

    def export_single(self, request: SingleExportRequest) -> ExportPrepared:
        """生成单页 PDF 并写入私有 Blob。"""
        source_bytes = self._blob_writer.read_private_bytes(request.source_url)
        pdf_bytes = self._render_single_pdf(source_bytes, request)
        filename = self._build_single_filename(request.source_name, request.paper)
        stored = self._store_pdf(filename, pdf_bytes)
        return ExportPrepared(filename=filename, pathname=stored.pathname)

    def export_tiles(self, request: TileExportRequest) -> ExportPrepared:
        """生成分页 PDF 并写入私有 Blob。"""
        source_bytes = self._blob_writer.read_private_bytes(request.source_url)
        pdf_bytes = self._render_tiles_pdf(source_bytes, request)
        filename = self._build_tile_filename(
            request.source_name, request.paper, request.cols, request.rows
        )
        stored = self._store_pdf(filename, pdf_bytes)
        return ExportPrepared(filename=filename, pathname=stored.pathname)

    def _store_pdf(self, filename: str, pdf_bytes: bytes) -> StoredBlob:
        """把 PDF 按会话隔离路径写入私有 Blob。"""
        storage_path = f"exports/{datetime.now().strftime('%Y/%m/%d')}/{uuid4().hex}/{filename}"
        return self._blob_writer.put_private_bytes(
            storage_path,
            pdf_bytes,
            content_type="application/pdf",
        )

    def _render_single_pdf(self, source_bytes: bytes, request: SingleExportRequest) -> bytes:
        """按当前取景框裁出单页 PDF。"""
        page_w_inch, page_h_inch = page_size_inch(request.paper, request.orientation)
        page_w_px = int(round(page_w_inch * request.dpi))
        page_h_px = int(round(page_h_inch * request.dpi))
        with Image.open(io.BytesIO(source_bytes)) as image:
            rgb_image = image.convert("RGB")
            width, height = rgb_image.size
            x1 = max(0, min(request.crop_x, width))
            y1 = max(0, min(request.crop_y, height))
            x2 = max(0, min(request.crop_x + request.crop_w, width))
            y2 = max(0, min(request.crop_y + request.crop_h, height))
            if x2 <= x1 or y2 <= y1:
                raise ValueError("裁剪区域无效")
            cropped = rgb_image.crop((x1, y1, x2, y2))
            fitted = self._fit_crop_to_target(cropped, target_width=page_w_px, target_height=page_h_px)
            return self._image_to_pdf_bytes(fitted, resolution=request.dpi)

    def _render_tiles_pdf(self, source_bytes: bytes, request: TileExportRequest) -> bytes:
        """按分页网格裁出多页 PDF。"""
        page_w_inch, page_h_inch = page_size_inch(request.paper, request.orientation)
        page_w_px = int(round(page_w_inch * request.dpi))
        page_h_px = int(round(page_h_inch * request.dpi))
        total_w = request.cols * page_w_px
        total_h = request.rows * page_h_px

        with Image.open(io.BytesIO(source_bytes)) as image:
            rgb_image = image.convert("RGB")
            src_w, src_h = rgb_image.size
            x1 = max(0, min(request.crop_x, src_w))
            y1 = max(0, min(request.crop_y, src_h))
            x2 = max(0, min(request.crop_x + request.crop_w, src_w))
            y2 = max(0, min(request.crop_y + request.crop_h, src_h))
            if x2 <= x1 or y2 <= y1:
                raise ValueError("分页截取区域无效")

            cropped = rgb_image.crop((x1, y1, x2, y2))
            fitted = self._fit_crop_to_target(cropped, target_width=total_w, target_height=total_h)

            tiles: list[Image.Image] = []
            for row_index in range(request.rows):
                for col_index in range(request.cols):
                    tile_left = col_index * page_w_px
                    tile_top = row_index * page_h_px
                    tile = fitted.crop(
                        (
                            tile_left,
                            tile_top,
                            tile_left + page_w_px,
                            tile_top + page_h_px,
                        )
                    )
                    tiles.append(tile)
            return self._images_to_pdf_bytes(tiles, resolution=request.dpi)

    def _fit_crop_to_target(
        self,
        image: Image.Image,
        *,
        target_width: int,
        target_height: int,
    ) -> Image.Image:
        """把裁剪结果等比放大并居中裁到目标像素尺寸。"""
        crop_w, crop_h = image.size
        scale = max(target_width / crop_w, target_height / crop_h)
        scaled_w = int(round(crop_w * scale))
        scaled_h = int(round(crop_h * scale))
        scaled = image.resize((scaled_w, scaled_h), Image.LANCZOS)

        left = max(0, (scaled_w - target_width) // 2)
        top = max(0, (scaled_h - target_height) // 2)
        return scaled.crop((left, top, left + target_width, top + target_height))

    def _image_to_pdf_bytes(self, image: Image.Image, *, resolution: int) -> bytes:
        """把单张图片编码成 PDF 字节流。"""
        buffer = io.BytesIO()
        image.save(buffer, "PDF", resolution=resolution)
        return buffer.getvalue()

    def _images_to_pdf_bytes(self, images: list[Image.Image], *, resolution: int) -> bytes:
        """把多张图片编码成多页 PDF。"""
        if not images:
            raise ValueError("分页结果为空")
        buffer = io.BytesIO()
        first, *rest = images
        first.save(
            buffer,
            "PDF",
            resolution=resolution,
            save_all=True,
            append_images=rest,
        )
        return buffer.getvalue()

    def _build_single_filename(self, source_name: str, paper: str) -> str:
        """构建单页 PDF 文件名。"""
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        base_name = os.path.splitext(os.path.basename(source_name))[0]
        return f"{base_name}_view_{paper}_{ts}.pdf"

    def _build_tile_filename(self, source_name: str, paper: str, cols: int, rows: int) -> str:
        """构建分页 PDF 文件名。"""
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        base_name = os.path.splitext(os.path.basename(source_name))[0]
        return f"{base_name}_{paper.upper()}_{cols}x{rows}_{ts}.pdf"
