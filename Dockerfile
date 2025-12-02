# 使用 Python 官方镜像
FROM python:3.11-slim

# 设置工作目录
WORKDIR /app

# 设置环境变量
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# 安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY crop_server.py .
COPY crop.html .
COPY crop.css .
COPY crop.js .
COPY entrypoint.py .

# 暴露端口
EXPOSE 5000

# 使用 Python 启动脚本
CMD ["python", "entrypoint.py"]

