# 🖼️ 大图裁剪/分页打印工具

一个简单易用的本地 Web 工具，帮助你把大尺寸海报图片裁剪或分割成多页 **A3 / A4** 打印。

![Python](https://img.shields.io/badge/Python-3.7+-blue.svg)

---

## ✨ 功能特点

- **自由裁剪**：上传大图后，可视化框选想要打印的区域，导出单页 PDF
- **分页打印**：将大图自动分割成 N×M 页所选纸张（A3/A4），拼起来就是完整海报
- **纸张规格**：支持 **A4** 与 **A3**，可与竖版 / 横版组合
- **拖拽载入**：将图片或 PDF 拖入右侧预览区即可加载
- **PDF 载入**：在浏览器内用 PDF.js（`pdfjs-dist`，经 Vite 与主脚本一并打包）将指定页栅格化为图片，再沿用原有裁切与导出流程；**无需再访问 jsDelivr CDN**
- **适应屏幕**：「一键适应屏幕（含取景框）」按 **整图 ∪ 取景框（分页模式下为截取框）** 一并缩放到可视区域内
- **纸张方向**：支持竖版（Portrait）和横版（Landscape）两种方向
- **自定义 DPI**：可调节打印分辨率（默认 300 DPI）
- **实时预览**：所见即所得，调整参数后立即预览效果
- **一键启动**：自动检测并安装依赖，自动打开浏览器

---

## ☁️ Vercel Serverless 部署（当前推荐）

当前版本已经改造成 **Vercel 静态前端 + Serverless Functions + Private Blob** 架构：

- 浏览器先把源图片 **直传到 Vercel Blob**
- Python Serverless Function 从私有 Blob 读取图片并生成 PDF
- Node Function 为结果 PDF 签发 **短期下载链接**

这样可以避开 Vercel Function 对请求体 **4.5 MB** 的限制，也不再依赖本地磁盘跨请求保留临时文件。

### 首次部署

```bash
npm install
vercel link
vercel --prod
```

### 必需的存储配置

部署前请先在 Vercel 项目里创建 **Private Blob**：

1. 打开 Vercel 项目
2. 进入 **Storage**
3. 创建 **Blob**
4. 选择 **Private**
5. 让它连接到当前项目

连接完成后，项目会自动获得 Blob 访问能力（新项目通常走 OIDC；旧方式则会注入 `BLOB_READ_WRITE_TOKEN`）。

### 本地联调

推荐直接使用：

```bash
vercel dev
```

默认访问：`http://localhost:3000`

如果你只想改前端交互，也可以同时开：

```bash
npm run dev
vercel dev
```

此时浏览器打开 `http://localhost:5173/crop.html`，Vite 会把 `/api/*` 代理到本机 `3000` 端口的 Vercel dev server。

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

点击导出按钮后，前端会先把当前源图上传到 **Private Blob**，再调用 `/api/export_prepare` 或 `/api/tile_export_prepare` 生成 PDF，最后调用 `/api/blob-download-url` 换取一个 **短期签名下载链接** 并触发浏览器原生下载。

---

## 🖨️ 打印技巧

1. 打印时选择「实际大小」或「100%」，不要选择「适合页面」
2. 如果是分页打印，打印后按顺序拼接即可
3. 建议先打印一页测试效果

---

## 🛠️ 项目结构

```
打印海报插件/
├── api/                 # Vercel Serverless Functions（Python + Node）
├── vercel.json          # Vercel 构建、路由、函数配置
├── 启动.bat              # Windows 一键启动
├── run_crop_app.py       # macOS/Linux 启动脚本
├── crop_server.py        # 旧版本地 Flask 后端（兼容保留）
├── crop.html             # 前端页面
├── crop.css              # 样式文件
├── src/                  # 前端 TypeScript 源码（crop.ts、paper.ts 等）
├── dist/                 # Vite 构建产物（Vercel 静态输出目录）
├── package.json          # 前端依赖与 npm 脚本
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

### 前端开发与构建（TypeScript + Vite）

生产环境由 **Vercel 静态资源 + Serverless Functions** 提供，修改 `src/` 或 [`crop.css`](crop.css) 后执行 `npm run build` 即可得到最新静态产物。

**本地联调（推荐）**：直接运行 `vercel dev`。如果需要前端 HMR，可额外打开 `npm run dev`，浏览器访问 **`http://localhost:5173/crop.html`**，`/api/*` 会由 Vite 代理到本机 `3000` 端口的 Vercel dev server。

```bash
npm install
npm run build          # 一次性构建（更新 dist/）
npm run dev            # Vite 开发服务器 + 热更新
vercel dev             # 本地运行 Vercel Functions + 静态站点
npm run build:watch    # 仅监听构建写入 dist/
```

前端纸张尺寸与 serverless 导出层 `page_size_inch` 对齐逻辑的单测：

```bash
npm test
```

### 运行测试

```bash
pip install -r requirements-dev.txt
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest tests/ -v
```

若本机全局安装了会干扰 pytest 的插件（如部分环境的 `deepeval`），请保留环境变量 `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`。

---

## 🐳 Docker 部署（局域网共享）

> 下面这部分是 **旧版 Flask / Docker 兼容部署路径**。当前推荐优先使用上面的 **Vercel Serverless**。

如果你想让局域网内的其他用户也能访问使用，可以通过 Docker 部署。

### 前置要求

安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### 启动服务（推荐）

使用一键启动脚本，会自动获取本机 IP 并发送通知到飞书：

```bash
./start-docker.sh
```

### 手动启动

构建镜像前请在项目根目录执行 **`npm run build`**，保证 `dist/` 为最新（容器内只带 `dist/`，不再复制根目录 `crop.html` / `crop.css`）。

```bash
# 先获取本机 IP
export HOST_IP=$(ipconfig getifaddr en0)

# 启动服务（HOST_IP 会写入 HTTPS 证书 SAN，局域网访问建议显式设置）
docker-compose up -d --build
```

### 访问地址

- 本机访问：`http://localhost:15234`
- 局域网 HTTP 页面：`http://192.168.1.10:15234`
- 局域网 HTTPS 页面/下载：`https://192.168.1.10:15235`

容器启动时会在 **`docker-compose logs`** 中打印探测到的 IPv4 与可选环境变量 `HOST_IP`、`PUBLIC_URL`。局域网设备优先使用你在路由器/宿主机上看到的 **同一网段 IP**；容器内的 `172.x` 等地址通常仅在 Docker 网络内可达，其它手机连不上属正常现象，请在宿主机执行 `ipconfig` / `ifconfig` 或设置 `HOST_IP`。

Chrome 可能拦截局域网 HTTP 下载并提示 `loaded over an insecure connection`。Docker 会同时启动 HTTPS 端口 `15235`；前端在局域网 HTTP 页面上会自动把下载 URL 切到 HTTPS。若使用自签证书，首次打开 `https://你的IP:15235` 时需要在浏览器证书警告页手动继续。若你有正式证书，可把 `server.crt` 与 `server.key` 放到 `certs/` 或通过 `SSL_CERT_FILE`、`SSL_KEY_FILE` 指定。

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

### Q: 导出 PDF 下载卡住，或无反应

A: 导出流程为 **token + GET 导航下载**（`POST …_prepare` → 导航到 `GET /download/...`），请在浏览器 **开发者工具 Console** 查看以 `[download]` 开头的日志。若 Chrome 提示 `loaded over an insecure connection`，说明 HTTP 下载被拦截，请使用 `https://宿主机局域网IP:15235`，或从 HTTP 页面重新点击导出让前端自动跳到 HTTPS 下载端口。若使用自签证书，首次访问 HTTPS 地址需要手动继续。若 `/download/...` 返回 500，请查看容器日志。同一局域网请确保其它设备访问的是 **宿主机局域网 IP**，而不是容器内部的 `172.x` 地址。

---

## 📄 License

MIT License - 随便用，开心就好 🎉
