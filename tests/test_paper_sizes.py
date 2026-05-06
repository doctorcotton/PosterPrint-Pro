"""crop_server.page_size_inch 尺寸校验。"""
import pytest

from crop_server import (
    A3_HEIGHT_INCH,
    A3_WIDTH_INCH,
    A4_HEIGHT_INCH,
    A4_WIDTH_INCH,
    page_size_inch,
)


@pytest.mark.parametrize(
    "paper,orientation,expected",
    [
        ("a4", "portrait", (A4_WIDTH_INCH, A4_HEIGHT_INCH)),
        ("a4", "landscape", (A4_HEIGHT_INCH, A4_WIDTH_INCH)),
        ("a3", "portrait", (A3_WIDTH_INCH, A3_HEIGHT_INCH)),
        ("a3", "landscape", (A3_HEIGHT_INCH, A3_WIDTH_INCH)),
        ("A4", "Portrait", (A4_WIDTH_INCH, A4_HEIGHT_INCH)),
    ],
)
def test_page_size_inch_ok(paper, orientation, expected):
    assert page_size_inch(paper, orientation) == expected


def test_page_size_inch_rejects_unknown_paper():
    with pytest.raises(ValueError, match="不支持"):
        page_size_inch("a2", "portrait")


def test_page_size_inch_rejects_unknown_orientation():
    with pytest.raises(ValueError, match="不支持"):
        page_size_inch("a4", "square")
