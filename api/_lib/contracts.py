"""导出接口契约与入参校验。"""

from __future__ import annotations

from dataclasses import dataclass


class RequestValidationError(ValueError):
    """接口入参不合法。"""


def _require_string(payload: dict[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise RequestValidationError(f"缺少或非法字段: {key}")
    return value.strip()


def _require_int(payload: dict[str, object], key: str, minimum: int | None = None) -> int:
    value = payload.get(key)
    if isinstance(value, bool):
        raise RequestValidationError(f"字段 {key} 不能是布尔值")
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, float):
        parsed = int(value)
    elif isinstance(value, str):
        try:
            parsed = int(float(value.strip()))
        except ValueError as exc:
            raise RequestValidationError(f"字段 {key} 必须是整数") from exc
    else:
        raise RequestValidationError(f"缺少或非法字段: {key}")
    if minimum is not None and parsed < minimum:
        raise RequestValidationError(f"字段 {key} 不能小于 {minimum}")
    return parsed


@dataclass(frozen=True, slots=True)
class SingleExportRequest:
    """单页导出请求。"""

    source_url: str
    source_name: str
    crop_x: int
    crop_y: int
    crop_w: int
    crop_h: int
    dpi: int
    paper: str
    orientation: str


@dataclass(frozen=True, slots=True)
class TileExportRequest:
    """分页导出请求。"""

    source_url: str
    source_name: str
    cols: int
    rows: int
    dpi: int
    paper: str
    orientation: str
    crop_x: int
    crop_y: int
    crop_w: int
    crop_h: int


def parse_single_export_request(payload: dict[str, object]) -> SingleExportRequest:
    """把 JSON 负载收口成单页导出请求。"""
    return SingleExportRequest(
        source_url=_require_string(payload, "sourceUrl"),
        source_name=_require_string(payload, "sourceName"),
        crop_x=_require_int(payload, "cropX", minimum=0),
        crop_y=_require_int(payload, "cropY", minimum=0),
        crop_w=_require_int(payload, "cropW", minimum=1),
        crop_h=_require_int(payload, "cropH", minimum=1),
        dpi=max(72, _require_int(payload, "dpi", minimum=1)),
        paper=_require_string(payload, "paper").lower(),
        orientation=_require_string(payload, "orientation").lower(),
    )


def parse_tile_export_request(payload: dict[str, object]) -> TileExportRequest:
    """把 JSON 负载收口成分页导出请求。"""
    return TileExportRequest(
        source_url=_require_string(payload, "sourceUrl"),
        source_name=_require_string(payload, "sourceName"),
        cols=_require_int(payload, "cols", minimum=1),
        rows=_require_int(payload, "rows", minimum=1),
        dpi=max(72, _require_int(payload, "dpi", minimum=1)),
        paper=_require_string(payload, "paper").lower(),
        orientation=_require_string(payload, "orientation").lower(),
        crop_x=_require_int(payload, "cropX", minimum=0),
        crop_y=_require_int(payload, "cropY", minimum=0),
        crop_w=_require_int(payload, "cropW", minimum=1),
        crop_h=_require_int(payload, "cropH", minimum=1),
    )
