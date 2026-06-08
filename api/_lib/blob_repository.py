"""Blob 读写仓储，隐藏 Vercel Blob SDK 细节。"""

from __future__ import annotations

from dataclasses import dataclass

from vercel.blob import get, put


class BlobRepositoryError(RuntimeError):
    """Blob 操作失败。"""


class BlobNotFoundError(BlobRepositoryError):
    """源文件不存在或不可读。"""


@dataclass(frozen=True, slots=True)
class StoredBlob:
    """Blob 上传结果。"""

    pathname: str
    url: str
    download_url: str


class VercelBlobRepository:
    """对私有 Blob 的最小读写封装。"""

    def read_private_bytes(self, url_or_path: str) -> bytes:
        """读取私有 Blob 全量字节。"""
        result = get(url_or_path, access="private")
        if result.status_code == 404:
            raise BlobNotFoundError("源文件不存在，可能已过期")
        if result.status_code != 200:
            raise BlobRepositoryError(f"读取源文件失败，状态码: {result.status_code}")
        return result.content

    def put_private_bytes(
        self,
        pathname: str,
        content: bytes,
        *,
        content_type: str,
    ) -> StoredBlob:
        """写入私有 Blob，并返回 Blob 标识。"""
        result = put(
            pathname,
            content,
            access="private",
            content_type=content_type,
            add_random_suffix=False,
            overwrite=False,
        )
        return StoredBlob(
            pathname=result.pathname,
            url=result.url,
            download_url=result.download_url,
        )
