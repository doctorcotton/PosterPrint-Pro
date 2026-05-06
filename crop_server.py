#!/usr/bin/env python3
import os
import tempfile
from datetime import datetime

from flask import Flask, request, send_file, jsonify, send_from_directory
from PIL import Image

app = Flask(__name__)

# ISO 216，单位：英寸（竖版：宽 × 高）
A4_WIDTH_INCH = 8.27
A4_HEIGHT_INCH = 11.69
A3_WIDTH_INCH = 11.69
A3_HEIGHT_INCH = 16.54


def page_size_inch(paper: str, orientation: str) -> tuple[float, float]:
    """
    返回单页 PDF 的页面尺寸 (宽英寸, 高英寸)。
    paper: a4 | a3；orientation: portrait | landscape
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


@app.route("/")
def index():
    # 前端页面
    base_dir = os.path.dirname(os.path.abspath(__file__))
    return send_from_directory(base_dir, "crop.html")


@app.route("/<path:filename>")
def static_files(filename):
    # 提供静态文件（CSS、JS等）
    base_dir = os.path.dirname(os.path.abspath(__file__))
    return send_from_directory(base_dir, filename)


@app.route("/export", methods=["POST"])
def export_pdf():
    """
    接收前端上传的大图 + 裁剪坐标（基于原图像素），
    裁剪后生成单页 PDF 并返回给浏览器下载。
    """
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

    tmp_dir = tempfile.mkdtemp(prefix="poster_crop_")
    img_path = os.path.join(tmp_dir, f"src_{f.filename}")
    f.save(img_path)

    with Image.open(img_path) as im:
        width, height = im.size
        # 防止越界
        x1 = max(0, min(crop_x, width))
        y1 = max(0, min(crop_y, height))
        x2 = max(0, min(crop_x + crop_w, width))
        y2 = max(0, min(crop_y + crop_h, height))
        if x2 <= x1 or y2 <= y1:
            return jsonify({"error": "裁剪区域无效"}), 400

        cropped = im.crop((x1, y1, x2, y2))
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        base_name = os.path.splitext(os.path.basename(f.filename))[0]
        paper_tag = (paper or "a4").lower().strip()
        out_name = f"{base_name}_view_{paper_tag}_{ts}.pdf"
        out_path = os.path.join(tmp_dir, out_name)
        # resolution 控制 PDF 中的 DPI
        cropped.save(out_path, "PDF", resolution=dpi)

    return send_file(out_path, as_attachment=True, download_name=out_name)


@app.route("/tile_export", methods=["POST"])
def tile_export():
    """
    接收整张大图 + 分页参数（行列数、方向、DPI），
    生成多页 PDF（尽量铺满页面，按中心裁切，避免额外白边）。
    """
    if "image" not in request.files:
        return jsonify({"error": "缺少图片文件"}), 400

    f = request.files["image"]
    if f.filename == "":
        return jsonify({"error": "文件名为空"}), 400

    try:
        cols = int(float(request.form.get("cols", "2")))
        rows = int(float(request.form.get("rows", "2")))
        dpi = int(float(request.form.get("dpi", "300")))
        # 整体截取区域（可选）
        crop_x = request.form.get("crop_x")
        crop_y = request.form.get("crop_y")
        crop_w = request.form.get("crop_w")
        crop_h = request.form.get("crop_h")
        has_crop = crop_x is not None and crop_y is not None and crop_w is not None and crop_h is not None
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

    tmp_dir = tempfile.mkdtemp(prefix="poster_tiles_")
    img_path = os.path.join(tmp_dir, f"src_{f.filename}")
    f.save(img_path)

    with Image.open(img_path) as im:
        im = im.convert("RGB")
        src_w, src_h = im.size

        # 如果指定了整体截取区域，先裁剪
        if has_crop:
            x1 = max(0, min(crop_x, src_w))
            y1 = max(0, min(crop_y, src_h))
            x2 = max(0, min(crop_x + crop_w, src_w))
            y2 = max(0, min(crop_y + crop_h, src_h))
            if x2 > x1 and y2 > y1:
                im = im.crop((x1, y1, x2, y2))
                src_w, src_h = im.size

        # 为了尽量铺满整个 N×M 页面区域，使用类似 CSS cover 的策略：按较大比例缩放并居中裁切
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
        out_path = os.path.join(tmp_dir, out_name)

        first, *rest = tiles
        first.save(
            out_path,
            "PDF",
            resolution=dpi,
            save_all=True,
            append_images=rest,
        )

    return send_file(out_path, as_attachment=True, download_name=out_name)


if __name__ == "__main__":
    # 默认本地开发使用
    app.run(host="127.0.0.1", port=5000, debug=True)
