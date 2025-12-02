# 🖼️ 大图裁剪/分页打印工具

一个简单易用的本地 Web 工具，帮助你把大尺寸海报图片裁剪或分割成多页 A4 纸打印。

![Python](https://img.shields.io/badge/Python-3.7+-blue.svg)

---

## ✨ 功能特点

- **自由裁剪**：上传大图后，可视化框选想要打印的区域，导出单页 PDF
- **分页打印**：将大图自动分割成 N×M 页 A4 纸，拼起来就是完整海报
- **纸张方向**：支持竖版（Portrait）和横版（Landscape）两种方向
- **自定义 DPI**：可调节打印分辨率（默认 300 DPI）
- **实时预览**：所见即所得，调整参数后立即预览效果
- **一键启动**：自动检测并安装依赖，自动打开浏览器

---

## 📦 安装 Python

本工具需要 **Python 3.7** 或更高版本。

### macOS

macOS 通常自带 Python，可以在终端中运行以下命令检查：

```bash
python3 --version
```

如果没有安装，推荐使用 Homebrew 安装：

```bash
brew install python
```

或者从官网下载安装包：

👉 **[Python 官方下载页面](https://www.python.org/downloads/)**

### Windows

从官网下载安装包：

👉 **[Python 官方下载页面](https://www.python.org/downloads/)**

> ⚠️ **重要**：安装时请勾选 **「Add Python to PATH」** 选项！

---

## 🚀 启动方式

### Windows 用户

直接双击 **`启动.bat`** 文件即可！

### macOS 用户

在终端中进入项目目录，运行：

```bash
python3 run_crop_app.py
```

---

程序会：
1. 自动检测并安装所需依赖（Flask、Pillow）
2. 启动本地 Web 服务
3. 自动在浏览器中打开工具页面

### 手动启动（备选）

如果一键启动有问题，可以手动安装依赖后启动：

```bash
# 安装依赖
pip3 install flask pillow

# 启动服务
python3 crop_server.py
```

然后在浏览器中打开：**http://127.0.0.1:5000**

---

## 📖 使用说明

### 1. 上传图片

点击页面上的上传区域，选择要处理的大图（支持 JPG、PNG 等常见格式）。

### 2. 选择模式

- **裁剪模式**：拖动框选想要的区域，导出单页 PDF
- **分页模式**：设置行列数，将图片分割成多页 A4

### 3. 调整参数

| 参数 | 说明 |
|------|------|
| 行数 × 列数 | 分页模式下，图片分成几行几列（如 2×2 = 4 页 A4） |
| 纸张方向 | 竖版（Portrait）或横版（Landscape） |
| DPI | 打印分辨率，一般 300 即可，越高越清晰但文件越大 |

### 4. 导出 PDF

点击「导出 PDF」按钮，下载生成的 PDF 文件，直接打印即可！

---

## 🖨️ 打印技巧

1. 打印时选择「实际大小」或「100%」，不要选择「适合页面」
2. 如果是分页打印，打印后按顺序拼接即可
3. 建议先打印一页测试效果

---

## 🛠️ 项目结构

```
打印海报插件/
├── 启动.bat           # Windows 一键启动
├── run_crop_app.py    # macOS/Linux 启动脚本
├── crop_server.py     # Flask 后端服务
├── crop.html          # 前端页面
├── crop.css           # 样式文件
├── crop.js            # 前端逻辑
├── poster_tiler.py    # 命令行版本（可选）
└── README.md          # 本文档
```

---

## ❓ 常见问题

### Q: 启动时报错「command not found: python3」

A: 说明 Python 没有正确安装或没有加入 PATH。请参考上方安装说明重新安装。

### Q: 安装依赖时报错

A: 尝试手动安装：
```bash
pip3 install flask pillow --user
```

### Q: 浏览器没有自动打开

A: 手动在浏览器中访问 **http://127.0.0.1:5000**

### Q: 端口 5000 被占用

A: 可以修改 `run_crop_app.py` 中的端口号，或者关闭占用该端口的程序。

---

## 📄 License

MIT License - 随便用，开心就好 🎉

