# 本地视频服务 Dockerfile
# 支持 x86 (amd64) 与 ARM 部署，零依赖（仅 Python 标准库）
# 构建时通过 --platform 指定目标架构

FROM python:3.13-slim

# 安装 ffmpeg（用于转码 avi/mov/mkv 等不支持的格式为 MP4）
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 设置时区与语言
ENV TZ=Asia/Shanghai \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=3000

WORKDIR /app

# 复制代码
COPY server.py ./
COPY public ./public

# 创建视频目录（用户可通过 volume 挂载覆盖）
RUN mkdir -p /app/videos

# 声明端口与卷
EXPOSE 3000
VOLUME ["/app/videos"]

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; \
        sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:${PORT}/api/folders', timeout=3).status==200 else 1)" || exit 1

# 默认启动
CMD ["python", "server.py"]
