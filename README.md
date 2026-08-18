# 🎬 本地视频滑动播放器

> 把你硬盘里的视频变成「抖音式」滑动信息流 —— 手机滑一滑，本地视频刷着看。

零依赖、零云端、纯本地部署。Python 标准库后端 + 原生 JS 前端，一个 Docker 容器搞定所有。

---

## ✨ 功能特性

### 播放体验
- **上下滑动切换视频** — 三槽预加载（prev / current / next），切换零等待
- **图片模式** — 照片也能滑着看，支持自动切换间隔设置
- **进度条拖拽 seek** — 长按拖拽实时预览画面（Canvas 解码帧，绕开浏览器暂停态 bug）
- **倍速播放** — 长按进度条拖到右侧自动加速
- **静音 / 全屏** 一键切换

### 文件管理
- **左滑面板** — 浏览所有文件夹，点击即切换目录
- **移动到文件夹** — 把当前视频归类到其他文件夹
- **左滑删除文件夹** — 面板内直接左滑删除（带确认弹窗）
- **新建 / 重命名文件夹**
- **重命名视频文件**
- **删除视频** — 带二次确认，防误删

### 播放模式
| 模式 | 说明 |
|------|------|
| 全目录洗牌 | 所有文件夹视频混合随机播放 |
| 文件夹内洗牌 | 当前文件夹内随机（刷新后顺序固定，可回溯） |
| 文件夹内字母序 | 按文件名 A-Z 顺序播放 |

### 安全与部署
- **访问密码** — 可设置页面密码，保护隐私
- **Docker 一键部署** — 支持 x86 (amd64) 与 ARM
- **NAS 自动部署** — 推送 main 分支自动 SSH 部署到群晖
- **HTTP Range 流式播放** — 支持随意拖拽进度条，无需等待整文件加载

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────┐
│                   浏览器前端                     │
│  原生 JS + CSS（无框架）  |  三槽预加载滑动播放    │
│  事件委托 + CSS Contain  |  Canvas seek 预览      │
└────────────────────┬────────────────────────────┘
                     │ HTTP / fetch
┌────────────────────┴────────────────────────────┐
│              Python 标准库后端 (server.py)        │
│  零依赖（无 Flask/Django）  |  Range 流式传输       │
│  文件索引 + 文件夹管理     |  密码认证             │
└────────────────────┬────────────────────────────┘
                     │ volume 挂载
┌────────────────────┴────────────────────────────┐
│              本地视频文件目录                     │
│  /app/videos（支持子文件夹嵌套）                  │
└─────────────────────────────────────────────────┘
```

**为什么不用框架？** 整个后端只用 Python 标准库 `http.server`，零 `pip install`，镜像更小、启动更快、维护更简单。前端也是原生 JS，没有打包工具链的负担。

---

## 🚀 快速开始

### 方式一：Docker（推荐）

```bash
# 拉取镜像
docker pull ghcr.io/chaosl1996/video-player:v71

# 启动（把 ./videos 换成你的视频目录）
docker run -d \
  --name video-player \
  -p 3000:3000 \
  -v ./videos:/app/videos \
  --restart unless-stopped \
  ghcr.io/chaosl1996/video-player:v71
```

浏览器打开 `http://localhost:3000` 即可使用。

### 方式二：Docker Compose

```yaml
# docker-compose.yml
services:
  video:
    image: ghcr.io/chaosl1996/video-player:v71
    container_name: video-player
    ports:
      - "3000:3000"
    volumes:
      - ./videos:/app/videos
    environment:
      - TZ=Asia/Shanghai
      - AUTH_PASSWORD=  # 留空=无密码
    restart: unless-stopped
```

```bash
docker compose up -d
```

### 方式三：从 Release 下载 tar

```bash
# 下载 video_player_v71.tar.gz 后
docker load -i video_player_v71.tar.gz
docker run -d -p 3000:3000 -v ./videos:/app/videos video-player:v71
```

### 方式四：直接运行（开发调试）

```bash
git clone https://github.com/chaosl1996/local-video-swipe.git
cd local-video-swipe
python3 server.py
# 打开 http://localhost:3000
```

> 需要 Python 3.10+，无第三方依赖。

---

## 📱 手势 / 操作说明

| 手势 | 动作 | 效果 |
|------|------|------|
| ⬆️ 上滑 | 向上滑动 | 下一个视频 |
| ⬇️ 下滑 | 向下滑动 | 上一个视频 |
| 点击 | 单击画面 | 暂停 / 播放 |
| 长按拖拽 | 拖拽进度条 | seek 到指定位置（实时预览） |
| 右滑面板 | 从左边缘右滑 | 打开文件夹切换面板 |
| 左滑删除 | 文件夹列表内左滑 | 删除该文件夹（带确认） |

**键盘快捷键**（桌面端）：
- `↑` / `↓` — 上一个 / 下一个视频
- `Space` — 暂停 / 播放
- `M` — 静音切换
- `F` — 全屏切换

---

## ⚙️ 配置项

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `PORT` | `3000` | 服务端口 |
| `TZ` | `Asia/Shanghai` | 时区 |
| `AUTH_PASSWORD` | （空） | 访问密码，留空则无密码 |
| `VIDEOS_DIR` | `/app/videos` | 容器内视频目录路径 |

密码也可在设置页面直接设置（存储在容器内 `.auth_password` 文件），忘记密码删除该文件或改环境变量即可。

---

## 📂 项目结构

```
local-video-swipe/
├── server.py              # 后端：HTTP 服务 + API + 流式播放
├── public/
│   ├── index.html         # 页面结构
│   ├── app.js            # 前端全部逻辑（播放/手势/面板/设置）
│   └── style.css         # 样式
├── Dockerfile             # Docker 镜像构建
├── docker-compose.yml     # Compose 编排
├── .github/workflows/
│   └── deploy-nas.yml     # NAS 自动部署 CI/CD
├── videos/                # 视频目录（gitignore，用户数据）
└── .gitignore
```

---

## 🔧 技术细节

### 三槽预加载
播放器维护 `prev` / `current` / `next` 三个 video 槽位，提前加载相邻视频。切换时通过 CSS `translateY` 动画移动 feed 容器，切换完成后回收旧槽位加载新内容，用户感知零等待。

### 事件委托优化
文件夹列表从「每个 item 绑定监听器」改为「父容器统一委托」，监听器数量从 O(n) 降到 O(1)，配合 CSS `contain: layout paint style` 和 `transform: translateZ(0)` 隔离重绘层，解决大量文件夹时的滑动卡顿。

### Canvas seek 预览
移动端暂停视频后拖拽进度条，浏览器不刷新画面。用 `<canvas>` + `drawImage()` 直接绘制解码帧，绕开这个浏览器 bug。

### 转码模块（默认关闭）
内置 ffmpeg 转码功能，可把不支持的格式（avi/mov/mkv）转为 H.264 MP4。通过总开关 `AUTO_CONVERT_ENABLED` 控制，默认关闭——因为整文件转码会占满 CPU 导致卡顿。将来可改为 HLS 分片转码实现秒开。

---

## 🐛 已知问题

- 部分编码格式（如 HEVC/H.265）浏览器不支持播放，会显示格式不支持提示
- Safari 对某些 MP4 编码兼容性较差，建议使用 Chrome
- 转码功能默认关闭（整文件转码从未成功且会导致卡顿），如需启用修改 `app.js` 中 `AUTO_CONVERT_ENABLED = true`

---

## 📜 License

MIT License — 随意使用、修改、分享。

---

## 🙏 致谢

这个项目诞生于「想躺着用手机刷自己硬盘里的视频」这个简单需求。没有追踪、没有云端、没有账号，你的视频只在你自己的设备上。

如果觉得有用，欢迎 Star ⭐ 分享。
