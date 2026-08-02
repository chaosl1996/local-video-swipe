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
PORT = int(os.environ.get('PORT', '3000'))

# 检测 ffmpeg 是否可用（用于转码不支持的格式）
FFMPEG_BIN = shutil.which('ffmpeg')

# 启动时建立的索引: id -> {abs, folder, name}
VIDEO_INDEX = {}


def build_index():
    """递归扫描 VIDEOS_DIR，建立 id -> 视频元数据 的映射。返回 [{folder, count}]。"""
    VIDEO_INDEX.clear()
    folders = {}
    if not os.path.isdir(VIDEOS_DIR):
        try:
            os.makedirs(VIDEOS_DIR, exist_ok=True)
        except OSError:
            pass
        return []

    for root, _dirs, files in os.walk(VIDEOS_DIR):
        vids = []
        for f in files:
            if os.path.splitext(f)[1].lower() in VIDEO_EXT:
                abs_path = os.path.join(root, f)
                # folder 用相对 VIDEOS_DIR 的路径，根目录用 '/'
                rel_dir = os.path.relpath(root, VIDEOS_DIR)
                folder = '/' if rel_dir == '.' else rel_dir
                vid = abs_path
                vid_id = hashlib.sha1(vid.encode('utf-8')).hexdigest()[:16]
                VIDEO_INDEX[vid_id] = {
                    'abs': abs_path,
                    'folder': folder,
                    'name': f,
                }
                vids.append(vid_id)
        # 即使没有视频，也要记录该文件夹（含根目录），
        # 这样新建的空文件夹也能在列表中显示
        rel_dir = os.path.relpath(root, VIDEOS_DIR)
        folder = '/' if rel_dir == '.' else rel_dir
        folders[folder] = folders.get(folder, 0) + len(vids)

    return [{'folder': k, 'count': v} for k, v in sorted(folders.items())]


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
        if path == '/api/ffmpeg-check':
            return self.send_json({'available': FFMPEG_BIN is not None})
        if path.startswith('/api/stream/'):
            vid_id = path[len('/api/stream/'):]
            return self.api_stream(vid_id)
        # 其他静态资源（favicon 等）
        if path.startswith('/'):
            return self.serve_static(path.lstrip('/'))

        self.send_text('Not Found', 404)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == '/api/folders':
            return self.api_create_folder()
        if path.startswith('/api/videos/') and path.endswith('/move'):
            vid_id = path[len('/api/videos/'):-len('/move')]
            return self.api_move_video(vid_id)
        if path.startswith('/api/convert/'):
            vid_id = path[len('/api/convert/'):]
            return self.api_convert_video(vid_id)
        self.send_text('Not Found', 404)

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith('/api/videos/'):
            vid_id = path[len('/api/videos/'):]
            return self.api_delete_video(vid_id)
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
        # 直接返回所有视频列表，避免前端逐个文件夹发请求（慢）
        videos = [{'id': vid_id, 'folder': m['folder'], 'name': m['name']}
                  for vid_id, m in VIDEO_INDEX.items()]
        self.send_json({
            'root': VIDEOS_DIR,
            'total': len(VIDEO_INDEX),
            'folders': folders,
            'videos': videos,
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

    def api_convert_video(self, vid_id):
        """用 ffmpeg 将不支持的视频转为 MP4 (H.264 + AAC + faststart)。"""
        if not FFMPEG_BIN:
            return self.send_json({'ok': False, 'error': '服务器未安装 ffmpeg'}, 503)
        meta = VIDEO_INDEX.get(vid_id)
        if not meta:
            return self.send_json({'ok': False, 'error': '视频不存在'}, 404)
        src = meta['abs']
        if not os.path.isfile(src):
            return self.send_json({'ok': False, 'error': '文件不存在'}, 404)
        # 已经是 mp4 不需要转
        ext = os.path.splitext(src)[1].lower()
        if ext == '.mp4':
            return self.send_json({'ok': False, 'error': '已经是 MP4 格式'}, 400)
        # 输出路径：同目录下同名 .mp4
        base = os.path.splitext(src)[0]
        out_path = base + '.mp4'
        if os.path.exists(out_path):
            out_path = base + '_converted.mp4'
        # ffmpeg: H.264 + AAC + faststart，preset=fast 平衡速度与质量
        cmd = [
            FFMPEG_BIN, '-y', '-i', src,
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
            '-c:a', 'aac', '-b:a', '128k',
            '-movflags', '+faststart',
            out_path,
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            if result.returncode != 0:
                err = (result.stderr or '')[-500:]
                return self.send_json({'ok': False, 'error': '转码失败: ' + err}, 500)
        except subprocess.TimeoutExpired:
            return self.send_json({'ok': False, 'error': '转码超时（10分钟限制）'}, 504)
        except OSError as e:
            return self.send_json({'ok': False, 'error': str(e)}, 500)
        # 转码成功，删除原文件
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
        ctype = mimetypes.guess_type(abs_path)[0] or 'video/mp4'
        range_header = self.headers.get('Range')

        if range_header:
            # bytes=start-end
            try:
                spec = range_header.strip().split('=')[1]
                start_s, end_s = spec.split('-')
                start = int(start_s) if start_s else 0
                end = int(end_s) if end_s else size - 1
            except (IndexError, ValueError):
                return self.send_text('Bad Range', 400)
            if end >= size:
                end = size - 1
            if start > end or start < 0:
                start = 0
            length = end - start + 1
            self.send_response(206)
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Length', str(length))
            self.send_header('Content-Type', ctype)
            self.end_headers()
            try:
                with open(abs_path, 'rb') as f:
                    f.seek(start)
                    remaining = length
                    while remaining > 0:
                        chunk = f.read(min(1024 * 1024, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
            except BrokenPipeError:
                pass
        else:
            self.send_response(200)
            self.send_header('Content-Length', str(size))
            self.send_header('Content-Type', ctype)
            self.send_header('Accept-Ranges', 'bytes')
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
        # 静音掉 /api/stream 的大日志，保留其他
        msg = fmt % args
        if '/api/stream/' in msg:
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
