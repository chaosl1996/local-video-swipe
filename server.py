#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地视频服务（TikTok 风格）
- 上下滑动切换视频
- 长按快进 2x
- 支持全随机 / 文件夹随机 / 文件夹顺序三种播放模式

零依赖，仅使用 Python 标准库。
启动: python3 server.py
默认端口 3000，视频目录默认 ./videos（可用环境变量 VIDEOS_DIR 覆盖）。
"""

import os
import sys
import json
import shutil
import hashlib
import mimetypes
import subprocess
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')
VIDEOS_DIR = os.environ.get(
    'VIDEOS_DIR', os.path.join(BASE_DIR, 'videos')).rstrip(os.sep)

VIDEO_EXT = {'.mp4', '.webm', '.mov', '.mkv', '.m4v', '.avi', '.ogv'}
IMAGE_EXT = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif', '.avif', '.svg'}
# NAS/Windows/macOS 系统垃圾目录黑名单（文件夹名即命中，不需要完整路径）。
# os.walk 每进入一层就从 dirs 里移除这些名字，既不进入递归、也不记录入 folders 列表，
# 从根本上解决 Synology @eaDir 缩略图缓存（每个原图一个同名伪目录）占用 folders 列表
# 50%+ 槽位 → 真正的中文嵌套目录（剧情/日本/横屏…）被排到列表倒数 → 用户以为
# "左滑只能显示根目录文件夹，子文件夹看不到"的问题。
SKIP_DIRS = {
    '@eaDir', '@eadir',                   # Synology DSM 缩略图缓存（每图一个子目录）
    '@Recently-Snapshot',                 # Synology 最近快照目录
    '@recycle', '#recycle',               # 各 NAS 回收站
    '@sharebin', '@tmp',                  # QNAP/Synology 内部临时目录
    '#snapshot', '@S2S',                  # QNAP 快照目录
    '$RECYCLE.BIN', '$Recycle.Bin',       # Windows 回收站
    'System Volume Information',          # Windows 驱动器系统元数据
    'lost+found',                         # Linux ext4 等文件系统恢复目录
    '.thumbnails', '.thumb', '.thumbs',   # 各种缩略图缓存目录
    '._DAV',                              # macOS Finder 通过 SMB/WebDAV 写 NAS 时自动创建的 Apple Double 资源叉伪目录
    '.cache',                             # Linux 桌面通用缓存
    '__MACOSX',                           # macOS zip 解压附带的资源叉目录
    '__pycache__', '.git', '.svn',        # 开发用缓存目录（若用户误放进来）
}
# 媒体扩展名集合（小写，带点）——用于判断"以媒体扩展名结尾的伪目录"，
# 比如 @eaDir 下 Synology 会给 candy-love.jpg 建一个同名目录（连扩展名保留）存缩略图，
# 这种目录本质是缓存容器，不是用户的真实媒体目录，必须过滤。
_MEDIA_EXTS_ALL = set(e.lower() for e in VIDEO_EXT | IMAGE_EXT)


def is_trash_path(rel_dir):
    """判断 rel_dir（相对 VIDEOS_DIR，'根用 '' 或 '.' 或 '/'）是否是垃圾目录。
    命中规则（任一命中即垃圾）：
      1) 任一路径段名在 SKIP_DIRS 中
      2) 任一段以 ._ 开头（macOS Finder 经 SMB/WebDAV/AFP 写 NAS 时自动创建的 Apple Double 资源叉伪目录，如 ._宋轶、._DAV）
      3) 任一段以媒体扩展名结尾（@eaDir/xxx.jpg 伪目录——DSM 给每张图建同名缓存目录，扩展名保留）
    """
    if not rel_dir or rel_dir == '.':
        return False
    norm = rel_dir.lstrip('/').replace('\\', '/')
    segments = [s for s in norm.split('/') if s]
    for seg in segments:
        # 规则 1：精确匹配黑名单
        if seg in SKIP_DIRS:
            return True
        # 规则 2：Apple Double 通配（._ 开头）
        if seg.startswith('._'):
            return True
        # 规则 3：媒体扩展名结尾的伪目录
        ext = os.path.splitext(seg)[1].lower()
        if ext in _MEDIA_EXTS_ALL:
            return True
    return False
PORT = int(os.environ.get('PORT', '3000'))

# 密码保护：环境变量 AUTH_PASSWORD 设置访问密码，为空则无需密码
AUTH_PASSWORD = os.environ.get('AUTH_PASSWORD', '')
# 密码配置文件（可手动修改此文件来设置/修改/清除密码）
AUTH_FILE = os.path.join(BASE_DIR, '.auth_password')
# 已认证的 token 集合（内存存储，重启后需重新登录）
AUTH_TOKENS = set()


def load_auth_password():
    """读取密码：优先环境变量，其次配置文件。返回空字符串表示无密码。"""
    if AUTH_PASSWORD:
        return AUTH_PASSWORD
    try:
        with open(AUTH_FILE, 'r', encoding='utf-8') as f:
            return f.read().strip()
    except (OSError, IOError):
        return ''


def save_auth_password(pw):
    """保存密码到配置文件。传入空字符串则删除密码。"""
    if pw:
        with open(AUTH_FILE, 'w', encoding='utf-8') as f:
            f.write(pw)
    else:
        try:
            os.remove(AUTH_FILE)
        except OSError:
            pass


def generate_token():
    """生成随机认证 token"""
    import secrets
    return secrets.token_hex(24)

# 检测 ffmpeg 是否可用（用于转码不支持的格式）
FFMPEG_BIN = shutil.which('ffmpeg')

# 启动时建立的索引: id -> {abs, folder, name}
VIDEO_INDEX = {}
IMAGE_INDEX = {}


def build_index():
    """递归扫描 VIDEOS_DIR，建立 id -> 视频/图片元数据 的映射。

    返回 [{folder, count, video_count, image_count}]，
    其中 count 为 video_count 的别名以保持向后兼容。
    """
    VIDEO_INDEX.clear()
    IMAGE_INDEX.clear()
    folders = {}
    if not os.path.isdir(VIDEOS_DIR):
        try:
            os.makedirs(VIDEOS_DIR, exist_ok=True)
        except OSError:
            pass
        return []

    for root, _dirs, files in os.walk(VIDEOS_DIR):
        # 【垃圾目录过滤 1/2】当前层的子目录里，只要名字在 SKIP_DIRS 中就删除，
        # os.walk 就不会递归进入。必须用 _dirs[:] = ...（切片赋值）才能生效，不能重新赋值 _dirs = ...。
        _dirs[:] = [d for d in _dirs if d not in SKIP_DIRS]
        vids = []
        imgs = []
        rel_dir = os.path.relpath(root, VIDEOS_DIR)
        folder = '/' if rel_dir == '.' else rel_dir
        # 【垃圾目录过滤 2/2】当前目录是垃圾路径（@eaDir 段或伪目录扩展名结尾）→
        # 直接跳过：不加入 folders、不扫描里面的媒体文件（缓存缩略图不算用户媒体）
        if is_trash_path(rel_dir):
            continue
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            # normpath：消除挂载源路径含 //、..、./ 等情况，
            # 确保 sha1(id) 在容器内外一致。同时 folder 端的拼接也 norm。
            abs_path = os.path.normpath(os.path.join(root, f))
            if ext in VIDEO_EXT:
                file_id = hashlib.sha1(abs_path.encode('utf-8')).hexdigest()[:16]
                VIDEO_INDEX[file_id] = {
                    'abs': abs_path,
                    'folder': folder,
                    'name': f,
                    # 'native' = 浏览器可直接播放 (mp4/m4v/webm)；'convert' = 需 ffmpeg 转码
                    'format': 'native' if ext in ('.mp4', '.m4v', '.webm') else 'convert',
                }
                vids.append(file_id)
            elif ext in IMAGE_EXT:
                file_id = hashlib.sha1(abs_path.encode('utf-8')).hexdigest()[:16]
                IMAGE_INDEX[file_id] = {
                    'abs': abs_path,
                    'folder': folder,
                    'name': f,
                }
                imgs.append(file_id)
        # 即使没有视频/图片，也要记录该文件夹（含根目录），
        # 这样新建的空文件夹也能在列表中显示
        if folder not in folders:
            folders[folder] = {'video_count': 0, 'image_count': 0}
        folders[folder]['video_count'] += len(vids)
        folders[folder]['image_count'] += len(imgs)

    return [{
        'folder': k,
        'count': v['video_count'],
        'video_count': v['video_count'],
        'image_count': v['image_count'],
    } for k, v in sorted(folders.items())]


def safe_path(rel):
    """拼接 VIDEOS_DIR 与 rel，确保结果在 VIDEOS_DIR 内。"""
    rel = rel.lstrip('/')
    target = os.path.normpath(os.path.join(VIDEOS_DIR, rel))
    if not (target == VIDEOS_DIR or target.startswith(VIDEOS_DIR + os.sep)):
        return None
    return target


class Handler(BaseHTTPRequestHandler):
    server_version = 'LocalVideo/1.0'

    # ---------- 通用响应 ----------
    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    # ---------- 认证 ----------
    def is_authenticated(self):
        """检查是否已认证。无密码配置时直接通过。"""
        if not load_auth_password():
            return True
        # 从 Cookie 中读取 token
        cookie = self.headers.get('Cookie', '')
        for part in cookie.split(';'):
            part = part.strip()
            if part.startswith('auth_token='):
                token = part[len('auth_token='):]
                if token in AUTH_TOKENS:
                    return True
        return False

    def serve_login_page(self):
        """返回登录页（PC端常规输入框 + 手机端类解锁数字键盘）"""
        html = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<title>登录</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; background: #000; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif; }
body { display: flex; align-items: center; justify-content: center; padding: 20px; min-height: 100vh; }

/* ---------- 通用登录卡片 ---------- */
.login-card { width: 100%; max-width: 340px; background: #1c1c1e; border-radius: 16px; padding: 32px 24px; border: 1px solid rgba(255,255,255,0.08); }
.login-title { font-size: 20px; font-weight: 600; text-align: center; margin-bottom: 8px; }
.login-sub { color: rgba(255,255,255,0.5); font-size: 12px; text-align: center; margin-bottom: 24px; }
.login-btn { width: 100%; padding: 14px; background: #0a84ff; border: none; border-radius: 10px; color: #fff; font-size: 16px; font-weight: 500; cursor: pointer; }
.login-btn:active { opacity: 0.7; }
.login-error { color: #ff3b30; font-size: 13px; text-align: center; margin-top: 12px; min-height: 18px; }
.login-hint { color: rgba(255,255,255,0.4); font-size: 12px; text-align: center; margin-top: 20px; line-height: 1.6; }

/* ---------- PC 端：普通密码输入框 ---------- */
.login-input { width: 100%; padding: 14px; background: #2c2c2e; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; color: #fff; font-size: 16px; margin-bottom: 12px; box-sizing: border-box; }
.login-input:focus { outline: none; border-color: #0a84ff; }
/* 默认 PC 显示，手机端隐藏：窄屏触摸隐藏 */
@media (max-width: 600px) and (pointer: coarse) {
  .pc-login-only { display: none !important; }
}

/* ---------- 手机端：数字键盘解锁 UI ---------- */
.dots-row { display: flex; justify-content: center; gap: 16px; margin-bottom: 32px; min-height: 24px; }
.dot { width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,0.4); transition: all 0.15s; }
.dot.filled { background: #fff; border-color: #fff; transform: scale(1.1); }
.dot.error { background: transparent; border-color: #ff3b30; animation: shake 0.35s; }
@keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }

.numpad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 18px; user-select: none; -webkit-user-select: none; }
.np-key { width: 64px; height: 64px; margin: 0 auto; border-radius: 50%; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 26px; font-weight: 400; cursor: pointer; transition: background 0.08s, transform 0.08s; -webkit-tap-highlight-color: transparent; }
.np-key:active { background: rgba(255,255,255,0.25); transform: scale(0.94); }
.np-key.empty { background: transparent; border: none; cursor: default; }
.np-key.empty:active { background: transparent; transform: none; }
.np-key.backspace { background: rgba(255,255,255,0.04); }
.np-key.backspace svg { width: 28px; height: 28px; color: #fff; }

/* 默认手机端显示；宽屏或精细指针设备隐藏数字键盘区 */
.touch-login-only { display: none; }
@media (max-width: 600px) and (pointer: coarse) {
  .touch-login-only { display: block; }
  .login-card { max-width: 100%; background: transparent; border: none; padding: 20px 16px 32px; }
  body { align-items: flex-end; padding-bottom: calc(40px + env(safe-area-inset-bottom)); }
}
</style>
</head>
<body>
<form id="loginForm" autocomplete="off" class="login-card">
  <div class="login-title">登录</div>
  <div class="login-sub">请输入访问密码</div>

  <!-- PC 端：常规密码输入框 -->
  <div class="pc-login-only">
    <input type="password" class="login-input" id="password" placeholder="请输入密码" autocomplete="current-password" autofocus>
  </div>

  <!-- 手机端：密码圆点 + 数字键盘 -->
  <div class="touch-login-only">
    <div class="dots-row" id="dotsRow"></div>
    <div class="numpad" id="numpad">
      <button type="button" class="np-key" data-key="1">1</button>
      <button type="button" class="np-key" data-key="2">2</button>
      <button type="button" class="np-key" data-key="3">3</button>
      <button type="button" class="np-key" data-key="4">4</button>
      <button type="button" class="np-key" data-key="5">5</button>
      <button type="button" class="np-key" data-key="6">6</button>
      <button type="button" class="np-key" data-key="7">7</button>
      <button type="button" class="np-key" data-key="8">8</button>
      <button type="button" class="np-key" data-key="9">9</button>
      <button type="button" class="np-key empty"></button>
      <button type="button" class="np-key" data-key="0">0</button>
      <button type="button" class="np-key backspace" id="btnBackspace" aria-label="删除">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>
      </button>
    </div>
  </div>

  <!-- 隐藏 input：承载最终提交的密码值（PC直接输入、手机数字键盘填入） -->
  <input type="hidden" id="passwordHidden" name="password">

  <button type="submit" class="login-btn" id="submitBtn">进入</button>
  <div class="login-error" id="error"></div>
  <div class="login-hint">忘记密码？<br>可在服务器上编辑 .auth_password 文件<br>或设置环境变量 AUTH_PASSWORD</div>
</form>

<script>
(function(){
  const form = document.getElementById('loginForm');
  const pwInput = document.getElementById('password');          // PC
  const pwHidden = document.getElementById('passwordHidden');   // 统一提交源
  const errEl = document.getElementById('error');
  const submitBtn = document.getElementById('submitBtn');

  // 数字键盘 & 密码圆点（手机端）
  const dotsRow = document.getElementById('dotsRow');
  const MAX_DOTS = 20;   // 密码长度未知，最多渲染 20 个点（够用）
  let touchPw = '';

  function renderDots(shake) {
    dotsRow.innerHTML = '';
    // 至少渲染 6 个圆点（与手机解锁一致），超过实际位数的空心占位
    const count = Math.max(6, Math.min(MAX_DOTS, Math.max(6, touchPw.length)));
    for (let i = 0; i < count; i++) {
      const d = document.createElement('div');
      d.className = 'dot' + (i < touchPw.length ? ' filled' : '') + (shake ? ' error' : '');
      dotsRow.appendChild(d);
    }
  }
  if (dotsRow) {
    renderDots(false);
    // 数字键点击
    document.querySelectorAll('.np-key[data-key]').forEach(btn => {
      btn.addEventListener('click', () => {
        errEl.textContent = '';
        if (touchPw.length >= MAX_DOTS) return;
        touchPw += btn.dataset.key;
        renderDots(false);
      });
    });
    // 删除键
    const bs = document.getElementById('btnBackspace');
    if (bs) {
      bs.addEventListener('click', () => {
        errEl.textContent = '';
        touchPw = touchPw.slice(0, -1);
        renderDots(false);
      });
      // 长按删除：清空
      let t = null;
      bs.addEventListener('touchstart', (e) => {
        e.preventDefault();
        t = setTimeout(() => { touchPw = ''; renderDots(false); }, 500);
      }, { passive: false });
      bs.addEventListener('touchend', () => { if (t) { clearTimeout(t); t = null; } });
      bs.addEventListener('touchcancel', () => { if (t) { clearTimeout(t); t = null; } });
    }
  }

  function collectPassword() {
    // 优先用 PC 端密码框，否则用手机端 touchPw
    if (pwInput && pwInput.value !== '') return pwInput.value;
    return touchPw;
  }

  async function doSubmit(e) {
    if (e) e.preventDefault();
    const pw = collectPassword();
    if (!pw) {
      if (dotsRow) { renderDots(true); setTimeout(() => renderDots(false), 400); }
      errEl.textContent = '请输入密码';
      return;
    }
    errEl.textContent = '';
    submitBtn.disabled = true; submitBtn.style.opacity = 0.6;
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({password: pw}) });
      const data = await r.json();
      if (data.ok) { location.reload(); }
      else {
        errEl.textContent = data.error || '密码错误';
        if (dotsRow) {
          renderDots(true);
          setTimeout(() => { touchPw = ''; renderDots(false); }, 450);
        }
        if (pwInput) pwInput.value = '';
      }
    } catch (err) { errEl.textContent = '网络错误'; }
    finally { submitBtn.disabled = false; submitBtn.style.opacity = 1; }
  }

  form.addEventListener('submit', doSubmit);
})();
</script>
</body>
</html>'''
        body = html.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, text, status=200, content_type='text/plain; charset=utf-8'):
        body = text.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ---------- 路由 ----------
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        # 登录页和登录 API 不需要认证
        if path == '/login':
            return self.serve_login_page()
        if path == '/api/auth-status':
            return self.send_json({'required': bool(load_auth_password()), 'authenticated': self.is_authenticated()})

        # 其他所有请求需要认证
        if not self.is_authenticated():
            if path.startswith('/api/'):
                return self.send_json({'error': '未认证'}, 401)
            return self.serve_login_page()

        if path == '/' or path == '/index.html':
            return self.serve_static('index.html')
        if path == '/style.css':
            return self.serve_static('style.css')
        if path == '/app.js':
            return self.serve_static('app.js')
        if path == '/api/folders':
            return self.api_folders()
        if path == '/api/videos':
            return self.api_videos(qs)
        if path == '/api/images':
            return self.api_images(qs)
        if path == '/api/ffmpeg-check':
            return self.send_json({'available': FFMPEG_BIN is not None})
        if path.startswith('/api/stream/'):
            vid_id = path[len('/api/stream/'):]
            return self.api_stream(vid_id)
        if path.startswith('/api/image/'):
            img_id = path[len('/api/image/'):]
            return self.api_image(img_id)
        # 其他静态资源（favicon 等）
        if path.startswith('/'):
            return self.serve_static(path.lstrip('/'))

        self.send_text('Not Found', 404)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # 登录 API 不需要认证
        if path == '/api/login':
            return self.api_login()
        # 修改密码 API 需要已认证
        if path == '/api/change-password':
            if not self.is_authenticated():
                return self.send_json({'error': '未认证'}, 401)
            return self.api_change_password()

        # 其他 POST 请求需要认证
        if not self.is_authenticated():
            return self.send_json({'error': '未认证'}, 401)

        if path == '/api/folders':
            return self.api_create_folder()
        if path.startswith('/api/videos/') and path.endswith('/move'):
            vid_id = path[len('/api/videos/'):-len('/move')]
            return self.api_move_video(vid_id)
        if path.startswith('/api/images/') and path.endswith('/move'):
            img_id = path[len('/api/images/'):-len('/move')]
            return self.api_move_image(img_id)
        if path.startswith('/api/convert/'):
            vid_id = path[len('/api/convert/'):]
            return self.api_convert_video(vid_id)
        if path.startswith('/api/folders/') and path.endswith('/rename'):
            folder_name = path[len('/api/folders/'):-len('/rename')]
            return self.api_rename_folder(folder_name)
        if path.startswith('/api/videos/') and path.endswith('/rename'):
            vid_id = path[len('/api/videos/'):-len('/rename')]
            return self.api_rename_file(vid_id, 'video')
        if path.startswith('/api/images/') and path.endswith('/rename'):
            img_id = path[len('/api/images/'):-len('/rename')]
            return self.api_rename_file(img_id, 'image')
        self.send_text('Not Found', 404)

    def api_login(self):
        body = self.read_body()
        pw = body.get('password', '')
        if pw == load_auth_password():
            token = generate_token()
            AUTH_TOKENS.add(token)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Set-Cookie', 'auth_token=%s; Path=/; HttpOnly; SameSite=Lax' % token)
            resp = json.dumps({'ok': True}, ensure_ascii=False).encode('utf-8')
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
        else:
            self.send_json({'ok': False, 'error': '密码错误'}, 401)

    def api_change_password(self):
        body = self.read_body()
        new_pw = body.get('password', '')
        # 环境变量密码不允许通过 API 修改
        if AUTH_PASSWORD:
            return self.send_json({'ok': False, 'error': '密码由环境变量设置，请修改环境变量'}, 400)
        save_auth_password(new_pw)
        # 清除所有已登录 token，强制重新登录
        AUTH_TOKENS.clear()
        self.send_json({'ok': True})

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        # 需要认证
        if not self.is_authenticated():
            return self.send_json({'error': '未认证'}, 401)
        if path.startswith('/api/videos/'):
            vid_id = path[len('/api/videos/'):]
            return self.api_delete_video(vid_id)
        if path.startswith('/api/images/'):
            img_id = path[len('/api/images/'):]
            return self.api_delete_image(img_id)
        if path.startswith('/api/folders/'):
            folder_name = path[len('/api/folders/'):]
            return self.api_delete_folder(folder_name)
        self.send_text('Not Found', 404)

    def read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode('utf-8'))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    # ---------- API ----------
    def api_folders(self):
        folders = build_index()
        # 直接返回所有视频/图片列表，避免前端逐个文件夹发请求（慢）
        videos = [{'id': vid_id, 'folder': m['folder'], 'name': m['name'], 'format': m['format']}
                  for vid_id, m in VIDEO_INDEX.items()]
        images = [{'id': img_id, 'folder': m['folder'], 'name': m['name']}
                  for img_id, m in IMAGE_INDEX.items()]
        self.send_json({
            'root': VIDEOS_DIR,
            'total': len(VIDEO_INDEX),
            'total_images': len(IMAGE_INDEX),
            'folders': folders,
            'videos': videos,
            'images': images,
        })

    def api_videos(self, qs):
        folder = qs.get('folder', [None])[0]
        if folder:
            folder = urllib.parse.unquote(folder)
        items = []
        for vid_id, meta in VIDEO_INDEX.items():
            if not folder or folder == '__all__' or meta['folder'] == folder:
                items.append({
                    'id': vid_id,
                    'folder': meta['folder'],
                    'name': meta['name'],
                })
        self.send_json({'count': len(items), 'videos': items})

    def api_create_folder(self):
        body = self.read_body()
        name = (body.get('name') or '').strip().strip('/')
        if not name:
            return self.send_json({'ok': False, 'error': '文件夹名不能为空'}, 400)
        # 防止路径穿越
        if '..' in name or name.startswith('/'):
            return self.send_json({'ok': False, 'error': '非法文件夹名'}, 400)
        target = os.path.join(VIDEOS_DIR, name)
        target = os.path.normpath(target)
        if not (target == VIDEOS_DIR or target.startswith(VIDEOS_DIR + os.sep)):
            return self.send_json({'ok': False, 'error': '非法路径'}, 400)
        try:
            os.makedirs(target, exist_ok=True)
        except OSError as e:
            return self.send_json({'ok': False, 'error': str(e)}, 500)
        folders = build_index()
        self.send_json({'ok': True, 'folders': folders})

    def api_delete_video(self, vid_id):
        meta = VIDEO_INDEX.get(vid_id)
        if not meta:
            return self.send_json({'ok': False, 'error': '视频不存在'}, 404)
        abs_path = meta['abs']
        try:
            if os.path.isfile(abs_path):
                os.remove(abs_path)
        except OSError as e:
            return self.send_json({'ok': False, 'error': str(e)}, 500)
        folders = build_index()
        self.send_json({'ok': True, 'folders': folders})

    def api_move_video(self, vid_id):
        meta = VIDEO_INDEX.get(vid_id)
        if not meta:
            return self.send_json({'ok': False, 'error': '视频不存在'}, 404)
        body = self.read_body()
        dest_folder = (body.get('folder') or '/').strip().strip('/')
        # 目标文件夹路径
        if dest_folder:
            dest_dir = os.path.normpath(os.path.join(VIDEOS_DIR, dest_folder))
        else:
            dest_dir = VIDEOS_DIR
        if not (dest_dir == VIDEOS_DIR or dest_dir.startswith(VIDEOS_DIR + os.sep)):
            return self.send_json({'ok': False, 'error': '非法目标路径'}, 400)
        try:
            os.makedirs(dest_dir, exist_ok=True)
        except OSError as e:
            return self.send_json({'ok': False, 'error': str(e)}, 500)
        src = meta['abs']
        dst = os.path.join(dest_dir, meta['name'])
        # 同名冲突自动加后缀
        if os.path.exists(dst) and os.path.abspath(src) != os.path.abspath(dst):
            base, ext = os.path.splitext(meta['name'])
            i = 1
            while os.path.exists(dst):
                dst = os.path.join(dest_dir, f'{base}_{i}{ext}')
                i += 1
        try:
            shutil.move(src, dst)
        except OSError as e:
            return self.send_json({'ok': False, 'error': str(e)}, 500)
        folders = build_index()
        # 移动后文件绝对路径变化，id 也随之变化（id = sha1(abs_path)）
        # 把新 id 回传给前端，便于同步本地缓存
        new_id = hashlib.sha1(dst.encode('utf-8')).hexdigest()[:16]
        self.send_json({
            'ok': True,
            'folders': folders,
            'old_id': vid_id,
            'new_id': new_id,
            'new_folder': '/' if dest_folder == '' else dest_folder,
            'new_name': os.path.basename(dst),
        })

    def api_images(self, qs):
        folder = qs.get('folder', [None])[0]
        if folder:
            folder = urllib.parse.unquote(folder)
        items = []
        for img_id, meta in IMAGE_INDEX.items():
            if not folder or folder == '__all__' or meta['folder'] == folder:
                items.append({
                    'id': img_id,
                    'folder': meta['folder'],
                    'name': meta['name'],
                })
        self.send_json({'count': len(items), 'images': items})

    def api_image(self, img_id):
        meta = IMAGE_INDEX.get(img_id)
        if not meta:
            return self.send_text('Not Found', 404)
        abs_path = meta['abs']
        if not os.path.isfile(abs_path):
            return self.send_text('File missing', 404)
        ctype = mimetypes.guess_type(abs_path)[0] or 'application/octet-stream'
        size = os.path.getsize(abs_path)
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(size))
        self.send_header('Cache-Control', 'public, max-age=86400')
        self.end_headers()
        try:
            with open(abs_path, 'rb') as f:
                while True:
                    chunk = f.read(1024 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except BrokenPipeError:
            pass

    def api_delete_image(self, img_id):
        meta = IMAGE_INDEX.get(img_id)
        if not meta:
            return self.send_json({'ok': False, 'error': '图片不存在'}, 404)
        abs_path = meta['abs']
        try:
            if os.path.isfile(abs_path):
                os.remove(abs_path)
        except OSError as e:
            return self.send_json({'ok': False, 'error': str(e)}, 500)
        folders = build_index()
        self.send_json({'ok': True, 'folders': folders})

    def api_move_image(self, img_id):
        meta = IMAGE_INDEX.get(img_id)
        if not meta:
            return self.send_json({'ok': False, 'error': '图片不存在'}, 404)
        body = self.read_body()
        dest_folder = (body.get('folder') or '/').strip().strip('/')
        # 目标文件夹路径
        if dest_folder:
            dest_dir = os.path.normpath(os.path.join(VIDEOS_DIR, dest_folder))
        else:
            dest_dir = VIDEOS_DIR
        if not (dest_dir == VIDEOS_DIR or dest_dir.startswith(VIDEOS_DIR + os.sep)):
            return self.send_json({'ok': False, 'error': '非法目标路径'}, 400)
        try:
            os.makedirs(dest_dir, exist_ok=True)
        except OSError as e:
            return self.send_json({'ok': False, 'error': str(e)}, 500)
        src = meta['abs']
        dst = os.path.join(dest_dir, meta['name'])
        # 同名冲突自动加后缀
        if os.path.exists(dst) and os.path.abspath(src) != os.path.abspath(dst):
            base, ext = os.path.splitext(meta['name'])
            i = 1
            while os.path.exists(dst):
                dst = os.path.join(dest_dir, f'{base}_{i}{ext}')
                i += 1
        try:
            shutil.move(src, dst)
        except OSError as e:
            return self.send_json({'ok': False, 'error': str(e)}, 500)
        folders = build_index()
        # 移动后文件绝对路径变化，id 也随之变化（id = sha1(abs_path)）
        # 把新 id 回传给前端，便于同步本地缓存
        new_id = hashlib.sha1(dst.encode('utf-8')).hexdigest()[:16]
        self.send_json({
            'ok': True,
            'folders': folders,
            'old_id': img_id,
            'new_id': new_id,
            'new_folder': '/' if dest_folder == '' else dest_folder,
            'new_name': os.path.basename(dst),
        })

    def api_delete_folder(self, folder_name):
        # URL 解码（folder_name 可能包含子路径如 sub/deep）
        folder_name = urllib.parse.unquote(folder_name)
        # 不能删除根目录
        if not folder_name or folder_name == '/' or folder_name.strip() == '':
            return self.send_json({'ok': False, 'error': '不能删除根目录'}, 400)
        # 路径穿越保护
        target = safe_path(folder_name)
        if target is None or target == VIDEOS_DIR:
            return self.send_json({'ok': False, 'error': '非法路径'}, 400)
        if not os.path.isdir(target):
            return self.send_json({'ok': False, 'error': '文件夹不存在'}, 404)
        try:
            shutil.rmtree(target)
        except OSError as e:
            return self.send_json({'ok': False, 'error': str(e)}, 500)
        # 重建索引，自动清理 VIDEO_INDEX 和 IMAGE_INDEX 中属于该文件夹的条目
        folders = build_index()
        self.send_json({'ok': True, 'folders': folders})

    def api_rename_folder(self, folder_name):
        folder_name = urllib.parse.unquote(folder_name)
        if not folder_name or folder_name == '/' or folder_name.strip() == '':
            return self.send_json({'ok': False, 'error': '不能重命名根目录'}, 400)
        body = self.read_body()
        new_name = (body.get('new_name') or '').strip().strip('/')
        if not new_name:
            return self.send_json({'ok': False, 'error': '新名称不能为空'}, 400)
        if '..' in new_name or '/' in new_name or new_name.startswith('/'):
            return self.send_json({'ok': False, 'error': '非法文件夹名'}, 400)
        target = safe_path(folder_name)
        if target is None or target == VIDEOS_DIR:
            return self.send_json({'ok': False, 'error': '非法路径'}, 400)
        if not os.path.isdir(target):
            return self.send_json({'ok': False, 'error': '文件夹不存在'}, 404)
        new_target = os.path.normpath(os.path.join(os.path.dirname(target), new_name))
        if not (new_target == VIDEOS_DIR or new_target.startswith(VIDEOS_DIR + os.sep)):
            return self.send_json({'ok': False, 'error': '非法目标路径'}, 400)
        if os.path.exists(new_target):
            return self.send_json({'ok': False, 'error': '同名文件夹已存在'}, 400)
        try:
            os.rename(target, new_target)
        except OSError as e:
            return self.send_json({'ok': False, 'error': str(e)}, 500)
        folders = build_index()
        self.send_json({'ok': True, 'folders': folders})

    def api_rename_file(self, file_id, media_type):
        """重命名视频或图片文件。"""
        index = VIDEO_INDEX if media_type == 'video' else IMAGE_INDEX
        meta = index.get(file_id)
        if not meta:
            return self.send_json({'ok': False, 'error': '文件不存在'}, 404)
        body = self.read_body()
        new_name = (body.get('new_name') or '').strip()
        if not new_name:
            return self.send_json({'ok': False, 'error': '新名称不能为空'}, 400)
        if '/' in new_name or '\\' in new_name or '..' in new_name:
            return self.send_json({'ok': False, 'error': '非法文件名'}, 400)
        src = meta['abs']
        if not os.path.isfile(src):
            return self.send_json({'ok': False, 'error': '文件不存在'}, 404)
        # 保留原扩展名
        old_ext = os.path.splitext(meta['name'])[1]
        new_ext = os.path.splitext(new_name)[1]
        if new_ext.lower() != old_ext.lower():
            new_name = new_name + old_ext
        dst = os.path.join(os.path.dirname(src), new_name)
        if os.path.abspath(src) == os.path.abspath(dst):
            return self.send_json({'ok': True, 'old_id': file_id, 'new_id': file_id, 'new_name': meta['name']})
        if os.path.exists(dst):
            return self.send_json({'ok': False, 'error': '同名文件已存在'}, 400)
        try:
            os.rename(src, dst)
        except OSError as e:
            return self.send_json({'ok': False, 'error': str(e)}, 500)
        folders = build_index()
        new_id = hashlib.sha1(dst.encode('utf-8')).hexdigest()[:16]
        self.send_json({
            'ok': True,
            'folders': folders,
            'old_id': file_id,
            'new_id': new_id,
            'new_name': os.path.basename(dst),
        })

    def api_convert_video(self, vid_id):
        """用 ffmpeg 转成浏览器100%可播的 MP4：H.264 (libx264) + AAC LC (2ch@48k) + faststart。

        注意：即使扩展名已经是 .mp4 也允许转码，因为很多"MP4文件"内部是
        HEVC(H.265) / VP9 / MPEG-4 Part2 / DTS / AC-3 等浏览器无法解码的编码。
        """
        if not FFMPEG_BIN:
            return self.send_json({'ok': False, 'error': '服务器未安装 ffmpeg'}, 503)
        meta = VIDEO_INDEX.get(vid_id)
        if not meta:
            return self.send_json({'ok': False, 'error': '视频不存在'}, 404)
        src = meta['abs']
        if not os.path.isfile(src):
            return self.send_json({'ok': False, 'error': '文件不存在'}, 404)
        # 输出路径：同目录 → <stem>.mp4；<stem>.mp4 存在则 <stem>_converted.mp4；
        # 再冲突就加 _2/_3/...
        folder_dir = os.path.dirname(src)
        stem = os.path.splitext(os.path.basename(src))[0]
        out_path = os.path.join(folder_dir, stem + '.mp4')
        if os.path.normpath(out_path) == os.path.normpath(src):
            out_path = os.path.join(folder_dir, stem + '_converted.mp4')
        i = 2
        while os.path.exists(out_path):
            out_path = os.path.join(folder_dir, stem + '_converted_%d.mp4' % i)
            i += 1
        # ffmpeg 参数：
        #  -c:v libx264 preset=fast crf=23 → 通用高质量H.264，速度/质量平衡
        #  -c:a aac -ac 2 -ar 48000 -b:a 128k → 强制立体声 AAC LC，兼容所有浏览器
        #  -pix_fmt yuv420p → QuickTime/iOS 兼容像素格式
        #  -movflags +faststart → moov atom 移到文件头，允许流媒体
        #  -sn → 去掉字幕轨（字幕轨在某些浏览器会导致无法播放）
        cmd = [
            FFMPEG_BIN, '-y', '-i', src,
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '128k',
            '-movflags', '+faststart',
            '-sn',
            out_path,
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            if result.returncode != 0:
                # 失败清理残留半成品
                try:
                    if os.path.exists(out_path):
                        os.remove(out_path)
                except OSError:
                    pass
                err = (result.stderr or '')[-800:]
                return self.send_json({'ok': False, 'error': '转码失败: ' + err}, 500)
        except subprocess.TimeoutExpired:
            try:
                if os.path.exists(out_path):
                    os.remove(out_path)
            except OSError:
                pass
            return self.send_json({'ok': False, 'error': '转码超时（10分钟限制）'}, 504)
        except OSError as e:
            return self.send_json({'ok': False, 'error': str(e)}, 500)
        # 转码成功：删除**原始格式（mp4以外）的源文件**；若源就是mp4则保留(同编码的二次转码没必要删)
        src_ext = os.path.splitext(src)[1].lower()
        if src_ext != '.mp4':
            try:
                os.remove(src)
            except OSError:
                pass
        folders = build_index()
        new_id = hashlib.sha1(out_path.encode('utf-8')).hexdigest()[:16]
        self.send_json({
            'ok': True,
            'folders': folders,
            'old_id': vid_id,
            'new_id': new_id,
            'new_name': os.path.basename(out_path),
        })

    def api_stream(self, vid_id):
        meta = VIDEO_INDEX.get(vid_id)
        if not meta:
            return self.send_text('Not Found', 404)
        abs_path = meta['abs']
        if not os.path.isfile(abs_path):
            return self.send_text('File missing', 404)

        size = os.path.getsize(abs_path)
        size = int(size)
        ctype = mimetypes.guess_type(abs_path)[0] or 'video/mp4'
        # 一些浏览器对 .mkv/.avi 的 mimetypes 数据库缺失，默认 application/octet-stream 会触发下载而非播放
        ext = os.path.splitext(abs_path)[1].lower()
        if ctype in ('application/octet-stream', None, ''):
            fallback = {
                '.mp4': 'video/mp4',
                '.m4v': 'video/mp4',
                '.mov': 'video/quicktime',
                '.webm': 'video/webm',
                '.ogv': 'video/ogg',
                '.mkv': 'video/x-matroska',
                '.avi': 'video/x-msvideo',
            }
            ctype = fallback.get(ext, 'video/mp4')

        range_header = self.headers.get('Range')
        if range_header:
            # 规范：Range: bytes=<spec>
            # spec 允许：
            #   "S-E"  (从 S 到 E 包含两端)
            #   "S-"   (从 S 到文件末尾)
            #   "-L"   (最后 L 字节，尾段)
            #   "S-E, S'-E', ..."  (多段)
            # 注意：Python http.server 在多线程 ThreadingHTTPServer 下写 wfile 时
            # 若客户端 abort 会抛 BrokenPipeError，所有写文件阶段均需捕获。
            try:
                parts = range_header.strip().split('=', 1)
                if len(parts) != 2 or parts[0].strip().lower() != 'bytes':
                    raise ValueError('range unit not bytes')
                spec = parts[1].strip()
                if not spec:
                    raise ValueError('empty range spec')
                ranges = []
                for piece in spec.split(','):
                    piece = piece.strip()
                    if not piece:
                        continue
                    if piece.startswith('-'):
                        # 尾段："-L" → 最后 L 字节
                        try:
                            L = int(piece[1:])
                        except ValueError:
                            raise ValueError('bad suffix length')
                        if L <= 0:
                            raise ValueError('non-positive suffix length')
                        start = max(0, size - L)
                        end = size - 1
                    else:
                        if '-' not in piece:
                            raise ValueError('no dash in range piece')
                        s, e = piece.split('-', 1)
                        s = s.strip()
                        e = e.strip()
                        if not s and not e:
                            raise ValueError('empty start and end')
                        start = int(s) if s else 0
                        end = int(e) if e else size - 1
                    # 裁剪到文件范围
                    if start < 0:
                        start = 0
                    if end >= size:
                        end = size - 1
                    if start > end:
                        raise ValueError('start > end (%d > %d)' % (start, end))
                    ranges.append((start, end))
            except (ValueError, IndexError):
                # 任何解析失败都要返回 416 Range Not Satisfiable + 正确 Content-Range 头
                self.send_response(416)
                self.send_header('Content-Range', 'bytes */%d' % size)
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Length', '0')
                self.end_headers()
                return

            if not ranges:
                self.send_response(416)
                self.send_header('Content-Range', 'bytes */%d' % size)
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Length', '0')
                self.end_headers()
                return

            # 只响应单个 Range：多段(multipart/byteranges) 极少被浏览器实际使用，
            # 且实现复杂容易出 Bug。如果客户端要多段，就只返回第一段。
            # (真实浏览器永远先发 "0-1" 或 "0-0" 单段试探)
            start, end = ranges[0]
            length = end - start + 1
            self.send_response(206)
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Length', str(length))
            self.send_header('Content-Type', ctype)
            # 关键：客户端在 docker 内部/跨网段 访问时，
            # Cache-Control: no-transform 禁止反向代理或 NAS 前端把 Range 内容"二次封装"改写
            self.send_header('Cache-Control', 'no-transform, public')
            # CORS：允许任何页面（含 iframe/远程控制面板）直接播放
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            try:
                with open(abs_path, 'rb') as f:
                    f.seek(start)
                    remaining = length
                    chunk_size = 256 * 1024   # 256KB 块（更小块更及时捕获客户端 abort）
                    while remaining > 0:
                        to_read = min(chunk_size, remaining)
                        chunk = f.read(to_read)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass
        else:
            self.send_response(200)
            self.send_header('Content-Length', str(size))
            self.send_header('Content-Type', ctype)
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Cache-Control', 'no-transform, public')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            try:
                with open(abs_path, 'rb') as f:
                    while True:
                        chunk = f.read(256 * 1024)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass

    # ---------- 静态文件 ----------
    def serve_static(self, rel):
        rel = rel.lstrip('/')
        target = os.path.normpath(os.path.join(PUBLIC_DIR, rel))
        if not (target == PUBLIC_DIR or target.startswith(PUBLIC_DIR + os.sep)):
            return self.send_text('Forbidden', 403)
        if not os.path.isfile(target):
            return self.send_text('Not Found', 404)
        ctype = mimetypes.guess_type(target)[0] or 'application/octet-stream'
        size = os.path.getsize(target)
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(size))
        # 静态资源：HTML/JS/CSS 不缓存以便更新立即生效
        if rel in ('index.html', 'app.js', 'style.css'):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        else:
            self.send_header('Cache-Control', 'public, max-age=3600')
        self.end_headers()
        try:
            with open(target, 'rb') as f:
                while True:
                    chunk = f.read(1024 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except BrokenPipeError:
            pass

    def log_message(self, fmt, *args):
        # 静音掉 /api/stream 和 /api/image/ 的大日志，保留其他
        msg = fmt % args
        if '/api/stream/' in msg or '/api/image/' in msg:
            return
        sys.stderr.write("%s - %s\n" % (self.address_string(), msg))


class ThreadedServer(ThreadingHTTPServer):
    daemon_threads = True


def main():
    build_index()
    print('\n  本地视频服务已启动: http://localhost:%d' % PORT)
    print('  视频目录: %s' % VIDEOS_DIR)
    print('  已索引视频: %d 个\n' % len(VIDEO_INDEX))
    print('  提示: 把视频放入 %s 目录（可建子文件夹），然后刷新页面。\n' % VIDEOS_DIR)
    server = ThreadedServer(('0.0.0.0', PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  已停止。')
        server.shutdown()


if __name__ == '__main__':
    main()
