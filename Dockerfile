# 使用 Python 官方镜像
FROM python:3.11-slim

# 设置工作目录
WORKDIR /app

# 设置环境变量
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# 生成局域网 HTTPS 自签证书需要 openssl；若挂载正式证书则不会使用它。
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# 安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码（前端页面与样式在 dist/ 内，需预先 npm run build）
COPY crop_server.py .
COPY dist ./dist
COPY entrypoint.py .
COPY certs ./certs

# 暴露端口
EXPOSE 5000
EXPOSE 5443

# 使用 Python 启动脚本
CMD ["python", "entrypoint.py"]
