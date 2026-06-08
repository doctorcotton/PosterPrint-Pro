"""Vercel Python Function 入口：薄边界，只负责校验、调用用例、格式化响应。"""

from __future__ import annotations

import json
from http import HTTPStatus
from typing import Callable

from flask import Flask, Response, jsonify, request

from api._lib.blob_repository import BlobNotFoundError, BlobRepositoryError, VercelBlobRepository
from api._lib.contracts import (
    RequestValidationError,
    parse_single_export_request,
    parse_tile_export_request,
)
from api._lib.poster_export_service import PosterExportService

app = Flask(__name__)

_blob_repository = VercelBlobRepository()
_poster_export_service = PosterExportService(_blob_repository)


def _json_log(event: str, **fields: object) -> None:
    """输出结构化日志，方便在 Vercel Runtime Logs 中检索。"""
    payload = {"event": event, "path": request.path, **fields}
    print(json.dumps(payload, ensure_ascii=False))


def _read_json_payload() -> dict[str, object]:
    """读取并校验 JSON body。"""
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise RequestValidationError("请求体必须是 JSON 对象")
    return payload


def _handle_export(
    parser: Callable[[dict[str, object]], object],
    executor: Callable[[object], object],
) -> Response:
    """复用两条导出路由的公共错误处理与响应格式。"""
    payload = _read_json_payload()
    parsed_request = parser(payload)
    prepared = executor(parsed_request)
    _json_log(
        "export_prepared",
        filename=getattr(prepared, "filename", ""),
        pathname=getattr(prepared, "pathname", ""),
    )
    return jsonify(
        {
            "filename": getattr(prepared, "filename"),
            "pathname": getattr(prepared, "pathname"),
        }
    )


@app.post("/api/export_prepare")
def export_prepare() -> Response:
    """单页 PDF 导出准备。"""
    try:
        return _handle_export(
            parse_single_export_request,
            _poster_export_service.export_single,
        )
    except RequestValidationError as exc:
        _json_log("request_invalid", error=str(exc))
        return jsonify({"error": str(exc)}), HTTPStatus.BAD_REQUEST
    except ValueError as exc:
        _json_log("business_invalid", error=str(exc))
        return jsonify({"error": str(exc)}), HTTPStatus.BAD_REQUEST
    except BlobNotFoundError as exc:
        _json_log("blob_missing", error=str(exc))
        return jsonify({"error": str(exc)}), HTTPStatus.NOT_FOUND
    except BlobRepositoryError as exc:
        _json_log("blob_failed", error=str(exc))
        return jsonify({"error": str(exc)}), HTTPStatus.BAD_GATEWAY


@app.post("/api/tile_export_prepare")
def tile_export_prepare() -> Response:
    """分页 PDF 导出准备。"""
    try:
        return _handle_export(
            parse_tile_export_request,
            _poster_export_service.export_tiles,
        )
    except RequestValidationError as exc:
        _json_log("request_invalid", error=str(exc))
        return jsonify({"error": str(exc)}), HTTPStatus.BAD_REQUEST
    except ValueError as exc:
        _json_log("business_invalid", error=str(exc))
        return jsonify({"error": str(exc)}), HTTPStatus.BAD_REQUEST
    except BlobNotFoundError as exc:
        _json_log("blob_missing", error=str(exc))
        return jsonify({"error": str(exc)}), HTTPStatus.NOT_FOUND
    except BlobRepositoryError as exc:
        _json_log("blob_failed", error=str(exc))
        return jsonify({"error": str(exc)}), HTTPStatus.BAD_GATEWAY


@app.get("/api/health")
def health() -> Response:
    """部署后可用于最小联通性探测。"""
    return jsonify({"ok": True})
