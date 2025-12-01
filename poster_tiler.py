#!/usr/bin/env python3
import os
import math
import shutil
import subprocess
import tempfile

A4_WIDTH_INCH = 8.27
A4_HEIGHT_INCH = 11.69

def ask(prompt, default=None, cast=str):
    if default is not None:
        full = f"{prompt} [{default}]: "
    else:
        full = f"{prompt}: "
    while True:
        s = input(full).strip()
        if not s:
            if default is not None:
                return default
            print("不能为空，请重新输入。")
            continue
        try:
            return cast(s)
        except Exception:
            print("输入格式不正确，请重试。")

def find_cmd(candidates):
    for c in candidates:
        if shutil.which(c):
            return c
    return None

def run(cmd, cwd=None):
    print("执行命令：", " ".join(cmd))
    res = subprocess.run(cmd, cwd=cwd)
    if res.returncode != 0:
        raise RuntimeError(f"命令执行失败：{' '.join(cmd)}")

def main():
    print("=== 大图分割成多页 A4 PDF 工具 ===")

    # 1. 检查依赖
    magick_cmd = find_cmd(["magick", "convert"])
    if not magick_cmd:
        print("未找到 ImageMagick（magick/convert），请先安装：brew install imagemagick")
        return

    # 2. 交互输入
    img_path = input("请输入大图路径（例如 /path/to/big_image.jpg）: ").strip()
    img_path = os.path.expanduser(img_path)
    if not os.path.isfile(img_path):
        print("找不到该文件，请确认路径是否正确。")
        return

    cols = ask("横向要分成几页（列数，例如 2）", default=2, cast=int)
    rows = ask("纵向要分成几页（行数，例如 2）", default=2, cast=int)
    dpi = ask("打印 DPI（一般 300 就够）", default=300, cast=int)
    orientation = ask("纸张方向（p=竖版 portrait，l=横版 landscape）", default="p", cast=str).lower()
    if orientation.startswith("l"):
        page_w_inch, page_h_inch = A4_HEIGHT_INCH, A4_WIDTH_INCH
        orient_label = "A4 横版"
    else:
        page_w_inch, page_h_inch = A4_WIDTH_INCH, A4_HEIGHT_INCH
        orient_label = "A4 竖版"
    keep_aspect = ask("保持原图比例（y/n，y=不拉伸，可能有白边）", default="y", cast=str).lower().startswith("y")

    default_out = os.path.splitext(os.path.basename(img_path))[0] + f"_A4_{cols}x{rows}.pdf"
    out_pdf = ask("输出 PDF 文件名", default=default_out, cast=str)

    # 3. 计算尺寸
    a4_w_px = int(round(page_w_inch * dpi))
    a4_h_px = int(round(page_h_inch * dpi))
    total_w = cols * a4_w_px
    total_h = rows * a4_h_px

    print(f"\n{orient_label} @ {dpi} DPI ≈ {a4_w_px}x{a4_h_px} 像素")
    print(f"整张大图目标尺寸 ≈ {total_w}x{total_h} 像素（{cols}x{rows} 页）\n")

    # 4. 临时目录处理
    with tempfile.TemporaryDirectory() as tmpdir:
        resized = os.path.join(tmpdir, "resized.jpg")
        tiles_pattern = os.path.join(tmpdir, "tile_%d.jpg")

        # 4.1 缩放
        resize_arg = f"{total_w}x{total_h}" + ("" if keep_aspect else "!")
        print(f"开始缩放图片（保持比例：{keep_aspect}）...")
        run([magick_cmd, img_path, "-resize", resize_arg, resized])

        # 4.2 按网格切割
        print("开始切割成网格图片...")
        run([magick_cmd, resized, "-crop", f"{cols}x{rows}@", "+repage", tiles_pattern])

        # 4.3 转成多页 PDF
        print("把小图合成为多页 PDF（仅设置 density，页面尺寸按 A4 像素计算）...")
        # 这里用 shell 展开 tile_*.jpg，方便顺序；直接输出到目标 PDF
        cmd = f'{magick_cmd} -density {dpi} "{tmpdir}/tile_*.jpg" "{out_pdf}"'
        print("执行命令：", cmd)
        res = subprocess.run(cmd, shell=True)
        if res.returncode != 0:
            raise RuntimeError("合成 PDF 失败")

    print(f"\n完成！输出文件：{os.path.abspath(out_pdf)}")
    print("你可以直接用预览或 Acrobat 打开后打印。")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n已取消。")
    except Exception as e:
        print("出错了：", e)