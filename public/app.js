// ==================== 状态 ====================
console.log('[app.js v5] loaded at', new Date().toISOString());
const state = {
  folders: [],          // [{ folder, count }]
  allVideos: [],        // [{ id, folder, name }]
  mode: localStorage.getItem('mode') || 'folder-random',
  selectedFolder: localStorage.getItem('folder') || '__all__',
  muted: localStorage.getItem('muted') === '1',
  autoNext: localStorage.getItem('autoNext') !== '0', // 默认开

  // 当前播放队列（根据 mode 和 folder 生成）
  queue: [],
  queueIndex: -1,

  // 三槽位：prev / current / next
  slots: { prev: null, current: null, next: null },

  // 滑动动画状态
  animating: false,
  longPressTimer: null,
  isLongPressing: false,
  originalRate: 1,
};

const SPEED_UP_RATE = 2.0;

// ==================== DOM ====================
const feed = document.getElementById('feed');
const slides = {
  prev: document.querySelector('[data-slot="prev"]'),
  current: document.querySelector('[data-slot="current"]'),
  next: document.querySelector('[data-slot="next"]'),
};
const videos = {
  prev: slides.prev.querySelector('video'),
  current: slides.current.querySelector('video'),
  next: slides.next.querySelector('video'),
};
const indicator = document.getElementById('indicator');
const infoEl = document.getElementById('info');
const speedBadge = document.getElementById('speed-badge');
const playBadge = document.getElementById('play-badge');
const errorBadge = document.getElementById('error-badge');
const btnConvert = document.getElementById('btnConvert');
const convertStatus = document.getElementById('convert-status');
let ffmpegAvailable = false;
const settingsPanel = document.getElementById('settings-panel');
const folderSelect = document.getElementById('folder-select');
const btnMute = document.getElementById('btnMute');
const btnFullscreen = document.getElementById('btnFullscreen');
const btnSettings = document.getElementById('btnSettings');
const btnRefresh = document.getElementById('btnRefresh');
const btnClose = document.getElementById('btnClose');

// 自定义弹窗（替代 confirm/alert）
const modal = document.getElementById('modal');
const modalMsg = document.getElementById('modalMsg');
const modalOk = document.getElementById('modalOk');
const modalCancel = document.getElementById('modalCancel');
function showConfirm(msg) {
  return new Promise((resolve) => {
    modalMsg.textContent = msg;
    modalCancel.style.display = '';
    modal.classList.remove('hidden');
    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    const onBackdrop = (e) => { if (e.target === modal) onCancel(); };
    const cleanup = () => {
      modal.classList.add('hidden');
      modalOk.removeEventListener('click', onOk);
      modalCancel.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
    };
    modalOk.addEventListener('click', onOk);
    modalCancel.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);
  });
}
function showAlert(msg) {
  return new Promise((resolve) => {
    modalMsg.textContent = msg;
    modalCancel.style.display = 'none';
    modal.classList.remove('hidden');
    const onOk = () => { cleanup(); resolve(); };
    const onBackdrop = (e) => { if (e.target === modal) cleanup(); };
    const cleanup = () => {
      modal.classList.add('hidden');
      modalOk.removeEventListener('click', onOk);
      modal.removeEventListener('click', onBackdrop);
    };
    modalOk.addEventListener('click', onOk);
    modal.addEventListener('click', onBackdrop);
  });
}

// 左侧面板（删除）& 移动面板
const leftPanel = document.getElementById('left-panel');
const movePanel = document.getElementById('move-panel');
const btnDelete = document.getElementById('btnDelete');
const btnLeftClose = document.getElementById('btnLeftClose');
const btnMoveClose = document.getElementById('btnMoveClose');
const moveFolderList = document.getElementById('move-folder-list');
const newFolderInput = document.getElementById('new-folder-input');
const btnNewFolder = document.getElementById('btnNewFolder');

// 进度条
const progressBar = document.getElementById('progress-bar');
const progressPlayed = document.getElementById('progress-played');
const progressBuffered = document.getElementById('progress-buffered');
const progressThumb = document.getElementById('progress-thumb');
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');

// ==================== 工具 ====================
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(arr, excludeId) {
  if (arr.length === 0) return null;
  if (arr.length === 1) return arr[0];
  let v;
  do { v = arr[Math.floor(Math.random() * arr.length)]; }
  while (v.id === excludeId);
  return v;
}

// ==================== 数据加载 ====================
async function loadFolders() {
  const r = await fetch('/api/folders');
  const data = await r.json();
  state.folders = data.folders;
  state.allVideos = [];

  // 拉取每个文件夹的视频列表
  for (const f of data.folders) {
    const vr = await fetch('/api/videos?folder=' + encodeURIComponent(f.folder));
    const vdata = await vr.json();
    vdata.videos.forEach((v) => state.allVideos.push(v));
  }

  updateFolderSelect(state.folders);
}

// 根据当前 mode 和 folder 生成播放队列
function buildQueue() {
  let pool;
  if (state.selectedFolder === '__all__') {
    pool = state.allVideos;
  } else {
    pool = state.allVideos.filter((v) => v.folder === state.selectedFolder);
  }

  if (state.mode === 'folder-seq') {
    state.queue = pool.slice().sort((a, b) =>
      (a.folder + '/' + a.name).localeCompare(b.folder + '/' + b.name)
    );
  } else {
    // all-random 与 folder-random 都用随机队列
    state.queue = shuffle(pool);
  }
  state.queueIndex = state.queue.length > 0 ? 0 : -1;
}

// 取当前队列中的下一个候选（不前进指针，用于预加载 next）
function peekNext(currentId) {
  if (state.queue.length === 0) return null;
  if (state.mode === 'folder-seq') {
    const idx = state.queue.findIndex((v) => v.id === currentId);
    if (idx === -1) return state.queue[0];
    return state.queue[(idx + 1) % state.queue.length];
  }
  // 随机模式：取一个不同的
  return pickRandom(state.queue, currentId);
}

function peekPrev(currentId) {
  if (state.queue.length === 0) return null;
  if (state.mode === 'folder-seq') {
    const idx = state.queue.findIndex((v) => v.id === currentId);
    if (idx === -1) return state.queue[0];
    return state.queue[(idx - 1 + state.queue.length) % state.queue.length];
  }
  return pickRandom(state.queue, currentId);
}

// ==================== 播放控制 ====================
function srcOf(video) {
  return '/api/stream/' + video.id;
}

function loadSlot(slotName, videoMeta) {
  const v = videos[slotName];
  v.onerror = null;
  v.ontimeupdate = null;
  v.onprogress = null;
  v.onloadedmetadata = null;
  if (!videoMeta) {
    v.pause();
    v.removeAttribute('src');
    v.load();
    state.slots[slotName] = null;
    return;
  }
  state.slots[slotName] = videoMeta;
  console.log(`[loadSlot:${slotName}]`, videoMeta.name, '->', srcOf(videoMeta));
  v.src = srcOf(videoMeta);
  v.load();
  v.muted = state.muted;
  v.preload = (slotName === 'prev') ? 'metadata' : 'auto';
  if (slotName === 'current') {
    v.onerror = () => {
      console.error('[video error]', v.error, 'code=', v.error && v.error.code, 'src=', v.src);
      errorBadge.classList.remove('hidden');
      // ffmpeg 可用时显示转码按钮
      if (ffmpegAvailable) {
        btnConvert.classList.remove('hidden');
        convertStatus.classList.add('hidden');
      } else {
        btnConvert.classList.add('hidden');
      }
      v.pause();
    };
    bindProgressEvents(v);
  }
}

// 是否已获得用户手势授权（首次交互后才能带声音播放）
let userInteracted = false;
['touchstart', 'mousedown', 'keydown'].forEach((evt) => {
  window.addEventListener(evt, () => { userInteracted = true; }, { once: true, capture: true });
});

function playCurrent() {
  const cur = state.slots.current;
  if (!cur) return;
  const v = videos.current;
  v.muted = userInteracted ? state.muted : true;
  v.playbackRate = 1;
  errorBadge.classList.add('hidden');
  console.log('[playCurrent] readyState=', v.readyState, 'muted=', v.muted, 'src=', v.src);
  v.play().then(() => {
    console.log('[playCurrent] PLAY OK, videoWidth=', v.videoWidth, 'videoHeight=', v.videoHeight);
    if (userInteracted && !state.muted) v.muted = false;
  }).catch((err) => {
    console.error('[playCurrent] PLAY REJECTED', err.name, err.message);
  });
  updateInfo();
}

// 单击切换暂停/继续
function togglePlay() {
  const v = videos.current;
  if (!v || !state.slots.current) return;
  if (v.paused) {
    // 用户手势触发的 play() 可以带声音
    if (userInteracted) v.muted = state.muted;
    v.play().catch(() => {});
  } else {
    v.pause();
  }
}

function syncPlayBadge() {
  const v = videos.current;
  if (v && v.paused && state.slots.current) {
    playBadge.classList.add('show');
  } else {
    playBadge.classList.remove('show');
  }
}

function updateInfo() {
  const cur = state.slots.current;
  if (!cur) {
    indicator.textContent = '没有视频';
    infoEl.textContent = '请把视频放入 ./videos 目录';
    return;
  }
  const idx = state.queue.findIndex((v) => v.id === cur.id);
  indicator.textContent =
    `${idx >= 0 ? idx + 1 : '?'} / ${state.queue.length} · ${cur.folder}`;
  infoEl.textContent = cur.name;
}

// 填充三个 slot：以 current 为中心
function fillSlots(centerVideo) {
  loadSlot('current', centerVideo);
  loadSlot('next', peekNext(centerVideo ? centerVideo.id : null));
  loadSlot('prev', peekPrev(centerVideo ? centerVideo.id : null));
}

// ==================== 滑动切换 ====================
function goTo(direction) {
  // direction: 1 = 下一个（向上滑）, -1 = 上一个（向下滑）
  if (state.animating) return;
  if (state.queue.length === 0) return;

  state.animating = true;
  feed.classList.add('animating');
  // 注意：不暂停当前视频，否则动画期间画面会冻结在最后一帧
  // 基准 translateY(-100%) 让 current(pos2) 显示。向上滑看 next(pos3)：-200%；向下滑看 prev(pos1)：0%
  const offsetPct = -100 - direction * 100;
  feed.style.transform = `translateY(${offsetPct}%)`;

  setTimeout(() => {
    // 切换：以"目标 slot"为新 current，重新组织
    if (direction === 1) {
      const newCurrent = state.slots.next || peekNext(state.slots.current && state.slots.current.id);
      const oldCurrent = state.slots.current;
      loadSlot('prev', oldCurrent);
      loadSlot('current', newCurrent);
      loadSlot('next', peekNext(newCurrent ? newCurrent.id : null));
    } else {
      const newCurrent = state.slots.prev || peekPrev(state.slots.current && state.slots.current.id);
      const oldCurrent = state.slots.current;
      loadSlot('next', oldCurrent);
      loadSlot('current', newCurrent);
      loadSlot('prev', peekPrev(newCurrent ? newCurrent.id : null));
    }
    // 暂停非 current 的 slot，避免后台解码占 GPU
    videos.prev.pause();
    videos.next.pause();
    // iOS Safari 样式重置时序问题：用 requestAnimationFrame 确保 transition:none 生效后再设 transform，
    // 下一帧再恢复 transition，避免 iOS 把 transform 变化和 transition 恢复合并导致动画丢失
    feed.style.transition = 'none';
    requestAnimationFrame(() => {
      feed.style.transform = 'translateY(-100%)';
      requestAnimationFrame(() => {
        feed.style.transition = '';
        feed.classList.remove('animating');
        state.animating = false;
        playCurrent();
      });
    });
  }, 310);
}

// ==================== 手势 ====================
let touchStartY = 0;
let touchStartX = 0;
let moved = false;

feed.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  touchStartY = e.touches[0].clientY;
  touchStartX = e.touches[0].clientX;
  moved = false;
  startLongPress();
}, { passive: true });

feed.addEventListener('touchmove', (e) => {
  const dy = e.touches[0].clientY - touchStartY;
  const dx = e.touches[0].clientX - touchStartX;
  // 提高阈值到 18px，避免手指轻微抖动被误判为滑动（安卓更敏感）
  if (Math.abs(dy) > 18 || Math.abs(dx) > 18) {
    moved = true;
    cancelLongPress();
  }
  // 始终阻止默认行为：iOS Safari 一旦发现 touchmove 未 preventDefault，
  // 会立即启动默认滚动/手势，劫持后续触摸事件流，导致滑动失效
  e.preventDefault();
}, { passive: false });

feed.addEventListener('touchend', (e) => {
  const wasLongPress = state.isLongPressing;
  cancelLongPress();
  if (moved) {
    const dy = e.changedTouches[0].clientY - touchStartY;
    const dx = e.changedTouches[0].clientX - touchStartX;
    // 水平滑动优先
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) {
      if (dx > 0) deleteCurrentVideo();
      else showMovePanel();
      e.preventDefault();
      return;
    } else if (Math.abs(dy) > 60) {
      goTo(dy < 0 ? 1 : -1);
      e.preventDefault();
      return;
    }
    // moved 但不满足滑动阈值（如华为手机轻微抖动）→ 当作点击处理
  }
  // 单击切换暂停/继续；长按快进松开后不切换
  if (!wasLongPress) {
    togglePlay();
  }
  e.preventDefault();
}, { passive: false });

// 鼠标滚轮（桌面端）
let wheelLock = false;
window.addEventListener('wheel', (e) => {
  if (wheelLock || state.animating) return;
  if (Math.abs(e.deltaY) < 30) return;
  wheelLock = true;
  goTo(e.deltaY > 0 ? 1 : -1);
  setTimeout(() => { wheelLock = false; }, 500);
}, { passive: true });

// 键盘
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'j') goTo(1);
  else if (e.key === 'ArrowUp' || e.key === 'k') goTo(-1);
  else if (e.key === ' ') {
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'm') toggleMute();
  else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  else if (e.key === 'ArrowLeft') {
    const v = videos.current; if (v && v.duration) v.currentTime = Math.max(0, v.currentTime - 5);
  } else if (e.key === 'ArrowRight') {
    const v = videos.current; if (v && v.duration) v.currentTime = Math.min(v.duration, v.currentTime + 5);
  }
});

// 桌面端鼠标：按下启动长按计时，松开时若未移动且未长按则切换暂停
let mouseStartX = 0;
let mouseStartY = 0;
let mouseMoved = false;
let mouseDownInFeed = false;

feed.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return; // 仅左键
  mouseStartX = e.clientX;
  mouseStartY = e.clientY;
  mouseMoved = false;
  mouseDownInFeed = true;
  startLongPress();
});

window.addEventListener('mousemove', (e) => {
  if (!mouseDownInFeed) return;
  if (Math.abs(e.clientX - mouseStartX) > 10 ||
      Math.abs(e.clientY - mouseStartY) > 10) {
    mouseMoved = true;
    cancelLongPress();
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  const wasLongPress = state.isLongPressing;
  cancelLongPress();
  // 桌面端拖拽滑动检测
  if (mouseDownInFeed && mouseMoved && !wasLongPress) {
    const dx = e.clientX - mouseStartX;
    const dy = e.clientY - mouseStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) {
      if (dx > 0) deleteCurrentVideo();
      else showMovePanel();
    } else if (Math.abs(dy) > 60) {
      goTo(dy < 0 ? 1 : -1);
    }
  }
  const shouldToggle = mouseDownInFeed && !mouseMoved && !wasLongPress;
  mouseDownInFeed = false;
  if (shouldToggle) togglePlay();
});

window.addEventListener('mouseleave', cancelLongPress);

// ==================== 长按快进 ====================
function startLongPress() {
  cancelLongPress();
  state.longPressTimer = setTimeout(() => {
    const v = videos.current;
    if (!v || v.readyState === 0) return;
    state.isLongPressing = true;
    state.originalRate = v.playbackRate || 1;
    v.playbackRate = SPEED_UP_RATE;
    speedBadge.classList.add('show');
  }, 500);
}

function cancelLongPress() {
  if (state.longPressTimer) {
    clearTimeout(state.longPressTimer);
    state.longPressTimer = null;
  }
  if (state.isLongPressing) {
    const v = videos.current;
    if (v) v.playbackRate = state.originalRate || 1;
    state.isLongPressing = false;
    speedBadge.classList.remove('show');
  }
}

// ==================== 删除 / 移动 / 新建文件夹 ====================
function showLeftPanel() {
  if (!state.slots.current) return;
  leftPanel.classList.remove('hidden');
}

function showMovePanel() {
  if (!state.slots.current) return;
  renderMoveFolderList();
  movePanel.classList.remove('hidden');
}

function renderMoveFolderList() {
  const cur = state.slots.current;
  moveFolderList.innerHTML = '';
  // 根目录选项
  const rootItem = document.createElement('div');
  rootItem.className = 'move-item' + (cur && cur.folder === '/' ? ' current' : '');
  rootItem.innerHTML = '<span>📁 根目录</span><span class="count">/</span>';
  rootItem.addEventListener('click', () => moveCurrentTo('/'));
  moveFolderList.appendChild(rootItem);
  // 各子文件夹
  state.folders.forEach((f) => {
    if (f.folder === '/') return;
    const item = document.createElement('div');
    item.className = 'move-item' + (cur && cur.folder === f.folder ? ' current' : '');
    item.innerHTML = `<span>📁 ${escapeHtml(f.folder)}</span><span class="count">${f.count}</span>`;
    item.addEventListener('click', () => moveCurrentTo(f.folder));
    moveFolderList.appendChild(item);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function deleteCurrentVideo() {
  const cur = state.slots.current;
  if (!cur) return;
  if (!await showConfirm(`确定删除「${cur.name}」？此操作不可恢复。`)) return;
  try {
    const r = await fetch('/api/videos/' + cur.id, { method: 'DELETE' });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || '删除失败');
    // 从 allVideos 移除
    state.allVideos = state.allVideos.filter((v) => v.id !== cur.id);
    // 更新文件夹下拉
    updateFolderSelect(data.folders);
    state.folders = data.folders;
    leftPanel.classList.add('hidden');
    // 重建队列并播放下一个
    rebuildAndPlay();
  } catch (e) {
    showAlert('删除失败: ' + e.message);
  }
}

async function moveCurrentTo(destFolder) {
  const cur = state.slots.current;
  if (!cur) return;
  if (cur.folder === destFolder) {
    movePanel.classList.add('hidden');
    return;
  }
  try {
    const r = await fetch('/api/videos/' + cur.id + '/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: destFolder }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || '移动失败');
    // 更新本地数据：移动后文件路径变化 → id 也变化，需用后端返回的新 id 同步
    const v = state.allVideos.find((v) => v.id === cur.id);
    if (v) {
      v.id = data.new_id;
      v.folder = data.new_folder || destFolder;
      if (data.new_name) v.name = data.new_name;
    }
    // 同步 slots 中可能存在的引用（prev/next 预加载）
    ['prev', 'current', 'next'].forEach((k) => {
      if (state.slots[k] && state.slots[k].id === cur.id) {
        state.slots[k].id = data.new_id;
        state.slots[k].folder = data.new_folder || destFolder;
        if (data.new_name) state.slots[k].name = data.new_name;
      }
    });
    updateFolderSelect(data.folders);
    state.folders = data.folders;
    movePanel.classList.add('hidden');
    // 重建队列并播放下一个（移动后视频可能已不在当前文件夹）
    rebuildAndPlay();
  } catch (e) {
    showAlert('移动失败: ' + e.message);
  }
}

async function createFolder() {
  const name = newFolderInput.value.trim();
  if (!name) return;
  try {
    const r = await fetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || '创建失败');
    state.folders = data.folders;
    updateFolderSelect(data.folders);
    newFolderInput.value = '';
    // 刷新移动面板的文件夹列表
    renderMoveFolderList();
  } catch (e) {
    showAlert('创建失败: ' + e.message);
  }
}

function updateFolderSelect(folders) {
  folderSelect.innerHTML = '';
  const optAll = document.createElement('option');
  optAll.value = '__all__';
  optAll.textContent = `全部 (${state.allVideos.length})`;
  folderSelect.appendChild(optAll);
  folders.forEach((f) => {
    const o = document.createElement('option');
    o.value = f.folder;
    o.textContent = `${f.folder} (${f.count})`;
    folderSelect.appendChild(o);
  });
  folderSelect.value = state.selectedFolder;
}

btnDelete.addEventListener('click', deleteCurrentVideo);
btnLeftClose.addEventListener('click', () => leftPanel.classList.add('hidden'));
btnMoveClose.addEventListener('click', () => movePanel.classList.add('hidden'));
btnNewFolder.addEventListener('click', createFolder);
newFolderInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createFolder();
});

// 点击遮罩背景关闭面板（点击卡片内不关闭）
leftPanel.addEventListener('click', (e) => {
  if (e.target === leftPanel) leftPanel.classList.add('hidden');
});
movePanel.addEventListener('click', (e) => {
  if (e.target === movePanel) movePanel.classList.add('hidden');
});
settingsPanel.addEventListener('click', (e) => {
  if (e.target === settingsPanel) settingsPanel.classList.add('hidden');
});

// ==================== 设置 ====================
function toggleMute() {
  state.muted = !state.muted;
  localStorage.setItem('muted', state.muted ? '1' : '0');
  Object.values(videos).forEach((v) => v.muted = state.muted);
  btnMute.querySelector('.icon').textContent = state.muted ? '🔇' : '🔊';
  btnMute.querySelector('.label').textContent = state.muted ? '取消静音' : '静音';
}

btnMute.addEventListener('click', toggleMute);

btnSettings.addEventListener('click', () => {
  settingsPanel.classList.remove('hidden');
});

btnClose.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
});

btnRefresh.addEventListener('click', async () => {
  btnRefresh.textContent = '刷新中…';
  btnRefresh.disabled = true;
  await init();
  btnRefresh.textContent = '刷新目录';
  btnRefresh.disabled = false;
  settingsPanel.classList.add('hidden');
});

document.querySelectorAll('input[name="mode"]').forEach((r) => {
  if (r.value === state.mode) r.checked = true;
  r.addEventListener('change', () => {
    state.mode = r.value;
    localStorage.setItem('mode', state.mode);
    rebuildAndPlay();
  });
});

folderSelect.addEventListener('change', () => {
  state.selectedFolder = folderSelect.value;
  localStorage.setItem('folder', state.selectedFolder);
  rebuildAndPlay();
});

// 自动翻页开关
const optAutoNext = document.getElementById('opt-autonext');
optAutoNext.checked = state.autoNext;
optAutoNext.addEventListener('change', () => {
  state.autoNext = optAutoNext.checked;
  localStorage.setItem('autoNext', state.autoNext ? '1' : '0');
});

function rebuildAndPlay() {
  buildQueue();
  if (state.queue.length > 0) {
    fillSlots(state.queue[0]);
    playCurrent();
  } else {
    fillSlots(null);
    updateInfo();
  }
}

// 视频结束：根据 autoNext 决定是否自动下一个
videos.current.addEventListener('ended', () => {
  if (state.autoNext) goTo(1);
});

// 暂停/播放时同步中央图标
videos.current.addEventListener('pause', syncPlayBadge);
videos.current.addEventListener('play', syncPlayBadge);
videos.current.addEventListener('waiting', syncPlayBadge);
videos.current.addEventListener('playing', syncPlayBadge);

// ==================== 进度条 ====================
function formatTime(sec) {
  if (!sec || !isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' + s : s);
}

function bindProgressEvents(v) {
  v.ontimeupdate = () => {
    if (progressDragging) return;
    updateProgress(v);
  };
  v.onprogress = () => {
    const buffered = v.buffered;
    if (buffered.length > 0) {
      const end = buffered.end(buffered.length - 1);
      const pct = v.duration ? (end / v.duration) * 100 : 0;
      progressBuffered.style.width = pct + '%';
    }
  };
  v.onloadedmetadata = () => {
    timeTotal.textContent = formatTime(v.duration);
    updateProgress(v);
  };
}

function updateProgress(v) {
  const pct = v.duration ? (v.currentTime / v.duration) * 100 : 0;
  progressPlayed.style.width = pct + '%';
  progressThumb.style.left = pct + '%';
  timeCurrent.textContent = formatTime(v.currentTime);
  if (v.duration) timeTotal.textContent = formatTime(v.duration);
}

// 拖拽进度条
let progressDragging = false;

function getProgressPct(clientX) {
  const rect = progressBar.getBoundingClientRect();
  let pct = (clientX - rect.left) / rect.width;
  if (pct < 0) pct = 0;
  if (pct > 1) pct = 1;
  return pct;
}

function seekToPct(pct) {
  const v = videos.current;
  if (!v || !v.duration || !isFinite(v.duration)) return;
  v.currentTime = pct * v.duration;
  progressPlayed.style.width = (pct * 100) + '%';
  progressThumb.style.left = (pct * 100) + '%';
  timeCurrent.textContent = formatTime(v.currentTime);
}

progressBar.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  progressDragging = true;
  progressBar.classList.add('dragging');
  progressBar.setPointerCapture(e.pointerId);
  const pct = getProgressPct(e.clientX);
  seekToPct(pct);
});

progressBar.addEventListener('pointermove', (e) => {
  if (!progressDragging) return;
  const pct = getProgressPct(e.clientX);
  seekToPct(pct);
});

progressBar.addEventListener('pointerup', (e) => {
  if (!progressDragging) return;
  progressDragging = false;
  progressBar.classList.remove('dragging');
  progressBar.releasePointerCapture(e.pointerId);
});

progressBar.addEventListener('pointercancel', () => {
  progressDragging = false;
  progressBar.classList.remove('dragging');
});

// ==================== 全屏 ====================
function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement ||
            document.webkitCurrentFullScreenElement);
}

function enterFullscreen() {
  const el = document.getElementById('app');
  // 标准 + webkit 前缀（注意 Chrome/Safari 大小写有两种变体）
  const fn = el.requestFullscreen || el.webkitRequestFullscreen ||
             el.webkitRequestFullScreen || el.msRequestFullscreen;
  if (fn) {
    const ret = fn.call(el);
    return ret && ret.then ? ret : Promise.resolve();
  }
  // iOS Safari 唯一可行方式：对 video 元素调用 webkitEnterFullscreen
  const v = videos.current;
  if (v && v.webkitEnterFullscreen) {
    v.webkitEnterFullscreen();
    return Promise.resolve();
  }
  return Promise.reject(new Error('当前浏览器不支持全屏 API'));
}

function exitFullscreen() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen ||
             document.webkitCancelFullScreen || document.msExitFullscreen;
  if (fn) {
    const ret = fn.call(document);
    return ret && ret.then ? ret : Promise.resolve();
  }
  // iOS video 退出全屏
  const v = videos.current;
  if (v && v.webkitExitFullscreen) {
    v.webkitExitFullscreen();
    return Promise.resolve();
  }
  return Promise.resolve();
}

async function toggleFullscreen() {
  try {
    if (!isFullscreen()) {
      await enterFullscreen();
      // 桌面/安卓 Chrome 全屏后锁定横屏（iOS 无此 API）
      if (screen.orientation && screen.orientation.lock) {
        try { await screen.orientation.lock('landscape'); } catch (_) {}
      }
    } else {
      await exitFullscreen();
      if (screen.orientation && screen.orientation.unlock) {
        try { screen.orientation.unlock(); } catch (_) {}
      }
    }
  } catch (e) {
    // 在 iframe 沙箱中可能被禁用，给出提示
    console.warn('全屏失败:', e);
    showAlert('无法进入全屏：' + (e.message || '浏览器不支持') +
          '\n\n提示：若在 iframe 预览中，请用浏览器直接打开 http://localhost:3000');
  }
  updateFullscreenBtn();
}

function updateFullscreenBtn() {
  const fs = isFullscreen();
  btnFullscreen.querySelector('.icon').textContent = fs ? '⤢' : '⛶';
  btnFullscreen.querySelector('.label').textContent = fs ? '退出' : '全屏';
}

btnFullscreen.addEventListener('click', toggleFullscreen);

document.addEventListener('fullscreenchange', updateFullscreenBtn);
document.addEventListener('webkitfullscreenchange', updateFullscreenBtn);
// iOS video 全屏状态变化
videos.current.addEventListener('webkitbeginfullscreen', updateFullscreenBtn);
videos.current.addEventListener('webkitendfullscreen', updateFullscreenBtn);

// 同步 muted 到所有 slot
Object.values(videos).forEach((v) => {
  v.muted = state.muted;
});

// ==================== 初始化 ====================
async function init() {
  // 检查服务端是否安装了 ffmpeg（决定是否显示转码按钮）
  try {
    const r = await fetch('/api/ffmpeg-check');
    const d = await r.json();
    ffmpegAvailable = !!d.available;
  } catch (e) { /* 默认不可用 */ }
  await loadFolders();
  if (state.allVideos.length === 0) {
    indicator.textContent = '没有视频';
    infoEl.textContent = '请把视频放入 ./videos 目录（可建子文件夹），然后点右上角刷新';
    return;
  }
  rebuildAndPlay();
  // 初始化静音图标
  btnMute.querySelector('.icon').textContent = state.muted ? '🔇' : '🔊';
  btnMute.querySelector('.label').textContent = state.muted ? '取消静音' : '静音';
}

// 转码按钮：将不支持的视频转为 MP4
btnConvert.addEventListener('click', async () => {
  const cur = state.slots.current;
  if (!cur) return;
  btnConvert.classList.add('hidden');
  convertStatus.classList.remove('hidden');
  convertStatus.textContent = '转码中，请稍候…';
  try {
    const r = await fetch('/api/convert/' + cur.id, { method: 'POST' });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || '转码失败');
    // 更新本地数据：用新 id 替换
    const v = state.allVideos.find((v) => v.id === data.old_id);
    if (v) {
      v.id = data.new_id;
      if (data.new_name) v.name = data.new_name;
    }
    state.folders = data.folders;
    updateFolderSelect(data.folders);
    convertStatus.textContent = '转码完成，正在加载…';
    // 重新加载播放
    setTimeout(() => {
      convertStatus.classList.add('hidden');
      rebuildAndPlay();
    }, 500);
  } catch (e) {
    convertStatus.textContent = '转码失败: ' + e.message;
    btnConvert.classList.remove('hidden');
  }
});

init();
