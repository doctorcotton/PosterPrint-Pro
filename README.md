# 🖼️ 大图裁剪/分页打印工具

一个简单易用的本地 Web 工具，帮助你把大尺寸海报图片裁剪或分割成多页 **A3 / A4** 打印。

![Python](https://img.shields.io/badge/Python-3.7+-blue.svg)

---

## ✨ 功能特点

- **自由裁剪**：上传大图后，可视化框选想要打印的区域，导出单页 PDF
- **分页打印**：将大图自动分割成 N×M 页所选纸张（A3/A4），拼起来就是完整海报
- **纸张规格**：支持 **A4** 与 **A3**，可与竖版 / 横版组合
- **拖拽载入**：将图片或 PDF 拖入右侧预览区即可加载
- **PDF 载入**：在浏览器内用 PDF.js 将指定页栅格化为图片，再沿用原有裁切与导出流程（需能访问 jsDelivr CDN；完全离线内网请自行把 `pdfjs-dist` 静态文件放到项目中并改 `crop.js` 引用路径）
- **适应屏幕**：「一键适应屏幕（含取景框）」按 **整图 ∪ 取景框（分页模式下为截取框）** 一并缩放到可视区域内
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

### 1. 载入图片或 PDF

- 点击左侧「选择文件」，或 **将文件拖入右侧预览区**
- 支持常见图片（JPG、PNG 等）与 **PDF**（默认渲染第 1 页；可修改页码后重新渲染）

### 2. 选择模式

- **单页取景**：拖动框选想要的区域，导出单页 PDF
- **分页模式**：设置行列数，将截取区域分割成多页所选纸张（A3/A4）

### 3. 调整参数

| 参数 | 说明 |
|------|------|
| 纸张规格 | A4 或 A3（与方向共同决定取景框比例与分页网格） |
| 行数 × 列数 | 分页模式下，截取区域分成几行几列（如 2×2 = 4 页） |
| 纸张方向 | 竖版或横版 |
| DPI | 打印分辨率，一般 300 即可，越高越清晰但文件越大 |

### 4. 导出 PDF

点击导出按钮下载 PDF。若进度卡住或提示 `blob:` /「应使用 HTTPS」，请参阅下方常见问题。

---

## 🖨️ 打印技巧

1. 打印时选择「实际大小」或「100%」，不要选择「适合页面」
2. 如果是分页打印，打印后按顺序拼接即可
3. 建议先打印一页测试效果

---

## 🛠️ 项目结构

```
打印海报插件/
├── 启动.bat              # Windows 一键启动
├── run_crop_app.py       # macOS/Linux 启动脚本
├── crop_server.py        # Flask 后端服务
├── crop.html             # 前端页面
├── crop.css              # 样式文件
├── crop.js               # 前端逻辑（ES Module + PDF.js）
├── tests/                # pytest 用例
├── pytest.ini            # pytest 配置
├── requirements-dev.txt  # 开发依赖（pytest）
├── poster_tiler.py       # 命令行版本（可选）
├── Dockerfile            # Docker 镜像构建文件
├── docker-compose.yml    # Docker Compose 编排文件
├── start-docker.sh       # Docker 一键启动脚本
├── entrypoint.py         # 容器启动脚本（含飞书通知）
└── README.md             # 本文档
```

### 运行测试

```bash
pip install -r requirements-dev.txt
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest tests/ -v
```

若本机全局安装了会干扰 pytest 的插件（如部分环境的 `deepeval`），请保留环境变量 `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`。

---

## 🐳 Docker 部署（局域网共享）

如果你想让局域网内的其他用户也能访问使用，可以通过 Docker 部署。

### 前置要求

安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### 启动服务（推荐）

使用一键启动脚本，会自动获取本机 IP 并发送通知到飞书：

```bash
./start-docker.sh
```

### 手动启动

```bash
# 先获取本机 IP
export HOST_IP=$(ipconfig getifaddr en0)

# 启动服务
docker-compose up -d --build
```

### 访问地址

- 本机访问：`http://localhost:15234`
- 局域网其他电脑访问：`http://你的电脑IP:15234`

### 🔔 飞书通知

服务启动时会自动发送通知到飞书，包含：
- 服务名称
- 访问地址（含当前 IP）
- 启动时间

这样其他用户就能从飞书获取最新的访问地址了！

### 停止服务

```bash
docker-compose down
```

### 查看日志

```bash
docker-compose logs -f
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

### Q: 导出 PDF 下载卡住，或提示 blob / 不安全 / 需要 HTTPS

A: 常见原因有两类：（1）浏览器下载管理器与 `blob:` 临时链接的时序问题——实现上已 **延迟释放** blob URL；可重试或换用 Chrome/Edge 最新版。（2）页面通过 **`http://局域网 IP`** 访问时，部分环境会限制非安全上下文下的下载；应在网关做 **HTTPS 反代**（Nginx、Caddy 等）或仅在受信任的 `https://` / `localhost` 下使用。

---

## 📄 License

MIT License - 随便用，开心就好 🎉

