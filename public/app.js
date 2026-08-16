// ==================== 状态 ====================
console.log('[app.js v68] loaded at', new Date().toISOString());
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
  longPressMode: null,      // 'seek' | 'speed' | null
  pureLongPress: false,     // true=按住未拖拽，松手恢复原倍速
  originalRate: 1,
  wasPlayingBeforeSeek: false,  // seek 前是否在播放，松手后恢复
  dragStartX: 0,
  dragStartY: 0,
  dragStartTime: 0,         // 视频 currentTime 拖拽起始值
  dragStartRateIdx: 2,      // SPEED_LEVELS 索引

  mediaType: localStorage.getItem('mediaType') || 'video',  // 'video' | 'image'
  allImages: [],            // [{ id, folder, name }]
  imageQueue: [],
  imageQueueIndex: -1,
  imageSlots: { prev: null, current: null, next: null },
  defaultVideoFolder: localStorage.getItem('defaultVideoFolder') || '__all__',
  defaultImageFolder: localStorage.getItem('defaultImageFolder') || '__all__',
  uiHidden: false,          // 图片模式下单击隐藏/显示 UI
  imageAutoInterval: parseInt(localStorage.getItem('imageAutoInterval') || '0', 10), // 0=不自动切换
  imageAutoTimer: null,     // 图片自动切换定时器
};

const SPEED_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const DEFAULT_SPEED_INDEX = 2; // 1x

// SVG 图标（统一风格，避免 emoji 跨平台不一致）
const SVG = {
  speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
  speakerMuted: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>',
  fullscreen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  fullscreenExit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  // speed-badge 使用纯文字（无图标），保持整体风格简洁
};

// ==================== DOM ====================
const feed = document.getElementById('feed');
const touchLayer = document.getElementById('touch-layer');
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
// seek 预览 canvas：解决手机暂停 seek 时不刷新画面
const seekCanvas = document.getElementById('seek-preview');
const seekCtx = seekCanvas ? seekCanvas.getContext('2d') : null;
const settingsPanel = document.getElementById('settings-panel');
const folderSelect = document.getElementById('folder-select');
const btnMute = document.getElementById('btnMute');
const btnFullscreen = document.getElementById('btnFullscreen');
const btnRefresh = document.getElementById('btnRefresh');

// ============================================================================
// 🔁 转码模块（默认关闭 — 见 AUTO_CONVERT_ENABLED 开关）
// 用户反馈：整文件转 MP4 从来没成功过，越转越卡（大量视频触发 5 处自动转码点 → 后端 ffmpeg 占满 CPU）。
// 因此默认总开关 = false，前端不再发起任何 /api/convert 请求，也不显示转码 UI。
// 如果将来想启用：把下面改成 true 即可（服务端 /api/ffmpeg-check 必须返回 available:true）。
// ============================================================================
const AUTO_CONVERT_ENABLED = false;
const btnConvert = document.getElementById('btnConvert');
const convertStatus = document.getElementById('convert-status');
let ffmpegAvailable = false;
const _convertingIds = new Set();   // 去重：同一视频不重复提交
// 初始化时 UI 就隐藏（不管 ffmpeg 是否可用，开关关了一律不显示）
if (btnConvert) btnConvert.classList.add('hidden');
if (convertStatus) convertStatus.classList.add('hidden');
// ============================================================================
// 🔁 转码模块结束（变量）
// ============================================================================
// btnClose 已移除，设置页底部功能栏按钮替代

// 自定义弹窗（替代 confirm/alert）
const modal = document.getElementById('modal');
const modalMsg = document.getElementById('modalMsg');
const modalOk = document.getElementById('modalOk');
const modalCancel = document.getElementById('modalCancel');
const modalInput = document.getElementById('modalInput');
// #modal 已移入 #app 内部，全屏 #app 时作为子元素可正常显示，无需退出全屏
function showConfirm(msg) {
  return new Promise((resolve) => {
    modalMsg.textContent = msg;
    modalCancel.style.display = '';
    modalInput.classList.add('hidden');
    // 比所有 panel（9999）高 2 级 + 内联 !important：彻底解决"从移动面板里弹 confirm，confirm 被面板盖在底下"
    modal.style.setProperty('z-index', '10001', 'important');
    modal.classList.remove('hidden');
    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    const onBackdrop = (e) => { if (e.target === modal) onCancel(); };
    const cleanup = () => {
      modal.classList.add('hidden');
      modal.style.removeProperty('z-index');
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
    modalInput.classList.add('hidden');
    modal.style.setProperty('z-index', '10001', 'important');
    modal.classList.remove('hidden');
    const onOk = () => { cleanup(); resolve(); };
    const onBackdrop = (e) => { if (e.target === modal) cleanup(); };
    const cleanup = () => {
      modal.classList.add('hidden');
      modal.style.removeProperty('z-index');
      modalOk.removeEventListener('click', onOk);
      modal.removeEventListener('click', onBackdrop);
    };
    modalOk.addEventListener('click', onOk);
    modal.addEventListener('click', onBackdrop);
  });
}
function showPrompt(title, defaultValue) {
  return new Promise((resolve) => {
    modalMsg.textContent = title;
    modalCancel.style.display = '';
    modalInput.classList.remove('hidden');
    modalInput.value = defaultValue || '';
    modal.style.setProperty('z-index', '10001', 'important');
    modal.classList.remove('hidden');
    setTimeout(() => modalInput.focus(), 50);
    const onOk = () => { cleanup(); resolve(modalInput.value.trim()); };
    const onCancel = () => { cleanup(); resolve(null); };
    const onBackdrop = (e) => { if (e.target === modal) onCancel(); };
    const onKey = (e) => { if (e.key === 'Enter') onOk(); if (e.key === 'Escape') onCancel(); };
    const cleanup = () => {
      modal.classList.add('hidden');
      modal.style.removeProperty('z-index');
      modalOk.removeEventListener('click', onOk);
      modalCancel.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
      modalInput.removeEventListener('keydown', onKey);
    };
    modalOk.addEventListener('click', onOk);
    modalCancel.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);
    modalInput.addEventListener('keydown', onKey);
  });
}

// 左侧面板（文件夹浏览/切换）& 删除确认弹窗 & 移动面板
const leftPanel = document.getElementById('left-panel');
const deleteModal = document.getElementById('delete-modal');
const movePanel = document.getElementById('move-panel');
const btnConfirmDelete = document.getElementById('btnConfirmDelete');
const btnDelete = document.getElementById('btnDelete');
const btnLeftClose = document.getElementById('btnLeftClose');
const btnMoveClose = document.getElementById('btnMoveClose');
const folderList = document.getElementById('folder-list');
const moveFolderList = document.getElementById('move-folder-list');
const newFolderInput = document.getElementById('new-folder-input');
const btnNewFolder = document.getElementById('btnNewFolder');

// ==================== 文件夹项：滑动/点击事件委托（卡顿核心优化） ====================
// 之前：每个 .swipe-item 绑 8 个监听器 → 200 条目录 = 1600 个监听器，滚动时浏览器要遍历 dispatch 大量事件 → 卡顿
// 现在：每个 .move-list 父容器只绑 7 个监听器，通过 e.target.closest 定位具体条目。
// 好处：监听器总数 O(1)（2 个列表 × 7 个 = 14 个），不随目录数量增加，1000 条目录滚动也不卡。
const _swipeState = new WeakMap();          // swipe-item → {startX, currentX, swiping, hasMoved, mouseDown, mouseMoved, mode:'touch'|'mouse', contentEl, folder, list}
let _swipeActiveItem = null;                 // 当前正在滑动的条目（全局，便于 touchmove 跨节点 tracking，不会漏 touchend 在条目外）

/**
 * 给一个 .move-list（folderList 或 moveFolderList）绑定委托事件
 * @param {HTMLElement} listEl 父列表容器
 * @param {{clickFolder?: (folder:string)=>void, deleteFolder?: (folder:string)=>Promise<void>}} handlers
 */
function bindSwipeDelegation(listEl, handlers) {
  if (!listEl || listEl._swipeBound) return;
  listEl._swipeBound = true;
  const isMoveList = listEl === moveFolderList;

  // 找 swipe-item 或 move-item（根目录项，没有 swipe wrapper）
  const findItem = (target) => target.closest('.swipe-item') || target.closest('.move-item');
  const findContent = (item) =>
    item && item.classList.contains('swipe-item')
      ? (item.querySelector(':scope > .move-item.swipe-content') || item.querySelector(':scope > .move-item'))
      : item;

  // ---------- Touch ----------
  listEl.addEventListener('touchstart', (e) => {
    if (!isMoveList) return;   // 左侧面板不支持滑动删除
    const item = findItem(e.target);
    if (!item || !item.classList.contains('swipe-item')) return;
    const content = findContent(item);
    if (!content) return;
    const t = e.touches[0];
    const st = { mode: 'touch', startX: t.clientX, currentX: t.clientX, swiping: true, hasMoved: false, contentEl: content };
    _swipeState.set(item, st);
    _swipeActiveItem = item;
    content.style.transition = '';
  }, { passive: true });

  listEl.addEventListener('touchmove', (e) => {
    if (!_swipeActiveItem) return;
    const st = _swipeState.get(_swipeActiveItem);
    if (!st || st.mode !== 'touch' || !st.swiping) return;
    const t = e.touches[0];
    st.currentX = t.clientX;
    const dx = t.clientX - st.startX;
    if (Math.abs(dx) > 3) st.hasMoved = true;
    if (dx < 0 && dx > -80) st.contentEl.style.transform = `translateX(${dx}px)`;
  }, { passive: true });

  listEl.addEventListener('touchend', () => {
    const item = _swipeActiveItem;
    _swipeActiveItem = null;
    if (!item) return;
    const st = _swipeState.get(item);
    if (!st || st.mode !== 'touch') return;
    st.swiping = false;
    const content = st.contentEl;
    content.style.transition = 'transform 0.2s';
    if (!st.hasMoved) {
      content.style.transform = '';
      return;
    }
    const dx = st.currentX - st.startX;
    if (dx < -40) {
      content.style.transform = '';
      const folder = item.dataset.folder;
      if (folder && handlers.deleteFolder) handlers.deleteFolder(folder);
    } else {
      content.style.transform = '';
    }
  });

  // ---------- Mouse ----------
  listEl.addEventListener('mousedown', (e) => {
    if (!isMoveList) return;
    const item = findItem(e.target);
    if (!item || !item.classList.contains('swipe-item')) return;
    if (e.button !== 0) return;
    const content = findContent(item);
    if (!content) return;
    const st = { mode: 'mouse', startX: e.clientX, currentX: e.clientX, mouseDown: true, mouseMoved: false, contentEl: content };
    _swipeState.set(item, st);
    _swipeActiveItem = item;
    content.style.transition = '';
    e.preventDefault();
  });

  listEl.addEventListener('mousemove', (e) => {
    if (!_swipeActiveItem) return;
    const st = _swipeState.get(_swipeActiveItem);
    if (!st || st.mode !== 'mouse' || !st.mouseDown) return;
    st.currentX = e.clientX;
    const dx = e.clientX - st.startX;
    if (Math.abs(dx) > 3) st.mouseMoved = true;
    if (dx < 0 && dx > -80) st.contentEl.style.transform = `translateX(${dx}px)`;
  });

  const finishMouse = () => {
    const item = _swipeActiveItem;
    _swipeActiveItem = null;
    if (!item) return;
    const st = _swipeState.get(item);
    if (!st || st.mode !== 'mouse' || !st.mouseDown) return;
    st.mouseDown = false;
    const content = st.contentEl;
    content.style.transition = 'transform 0.2s';
    if (!st.mouseMoved) {
      content.style.transform = '';
      return;
    }
    const dx = st.currentX - st.startX;
    if (dx < -40) {
      content.style.transform = '';
      const folder = item.dataset.folder;
      if (folder && handlers.deleteFolder) handlers.deleteFolder(folder);
    } else {
      content.style.transform = '';
    }
  };
  listEl.addEventListener('mouseup', finishMouse);
  listEl.addEventListener('mouseleave', () => {
    if (_swipeActiveItem && _swipeState.get(_swipeActiveItem)?.mode === 'mouse') finishMouse();
  });

  // ---------- Click（同时服务于两种列表：点击文件夹切换 / 移动；根目录项也是这里命中） ----------
  listEl.addEventListener('click', (e) => {
    // 如果当前 item 刚结束滑动（hasMoved=true），屏蔽 click（避免滑动完又触发点击切换目录）
    if (_swipeState.has(e.currentTarget)) {
      // noop
    }
    const item = findItem(e.target);
    if (!item) return;
    if (item.classList.contains('swipe-item')) {
      const st = _swipeState.get(item);
      if (st && (st.hasMoved || st.mouseMoved)) {
        st.hasMoved = false; st.mouseMoved = false;
        return;
      }
    }
    const folder = item.dataset.folder;
    if (!folder) return;
    if (handlers.clickFolder) handlers.clickFolder(folder);
  });
}

// 对 move-list 所有子项统一写高度兜底：rAF 中批量，只触发一次 reflow
function applyListItemHeights(listEl) {
  if (!listEl) return;
  requestAnimationFrame(() => {
    const MIN_H = 44;
    const len = listEl.children.length;
    for (let i = 0; i < len; i++) {
      const child = listEl.children[i];
      if (!child) continue;
      if (child.classList.contains('swipe-item')) {
        const inner = child.querySelector(':scope > .move-item');
        const h = inner ? inner.offsetHeight : MIN_H;
        child.style.minHeight = Math.max(MIN_H, (h || MIN_H)) + 'px';
      } else if (child.classList.contains('move-item')) {
        child.style.minHeight = Math.max(MIN_H, (child.offsetHeight || MIN_H)) + 'px';
      }
    }
  });
}

// 顶栏 indicator 点击 = 跳到设置页（切换文件夹入口在设置页 folder-select 下拉里；之前占了右滑手势，现在移到这里）
indicator.addEventListener('click', () => btnFuncSettings.click());

// 进度条
const progressBar = document.getElementById('progress-bar');
const progressPlayed = document.getElementById('progress-played');
const progressBuffered = document.getElementById('progress-buffered');
const progressThumb = document.getElementById('progress-thumb');
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');

// 图片模式 & 模式切换 & 多选
const feedImage = document.getElementById('feed-image');
const imgSlides = {
  prev: document.querySelector('[data-islot="prev"]'),
  current: document.querySelector('[data-islot="current"]'),
  next: document.querySelector('[data-islot="next"]'),
};
const imgs = {
  prev: imgSlides.prev.querySelector('img'),
  current: imgSlides.current.querySelector('img'),
  next: imgSlides.next.querySelector('img'),
};
// 主页面底部功能栏按钮（只选 #funcbar 下的，与设置页底部功能栏完全独立）
const funcButtons = document.querySelectorAll('#funcbar .func-btn[data-mode]');
const btnFuncSettings = document.getElementById('btnFuncSettings');
// 设置页底部功能栏按钮
const settingsFuncButtons = document.querySelectorAll('#funcbar-settings .func-btn[data-mode]');
const btnSettingsVideo = document.getElementById('btnSettingsVideo');
const btnSettingsImage = document.getElementById('btnSettingsImage');
const btnHelp = document.getElementById('btnHelp');
const defaultVideoFolderSelect = document.getElementById('default-video-folder');
const defaultImageFolderSelect = document.getElementById('default-image-folder');


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
  // 单次请求拿全部文件夹 + 视频/图片列表（避免逐文件夹串行请求导致卡顿）
  const r = await fetch('/api/folders');
  const data = await r.json();
  state.folders = data.folders || [];
  state.allVideos = data.videos || [];
  state.allImages = data.images || [];
  updateFolderSelect(state.folders);
  updateDefaultFolderSelects(state.folders);
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
// 【v68：folder-random = 洗牌列表模式】
//   rebuildAndPlay 时已经用 Fisher-Yates 把 state.queue 洗牌成一个固定顺序数组，
//   所以无论是 folder-seq 还是 folder-random，peekNext/peekPrev 都用「findIndex + 相邻下标」。
//   这样用户上滑到 idx+1，下滑回到 idx-1，一定是同一个视频 = 可回溯。
//   之前 folder-random 每次 pickRandom = 每次都不一样 = 用户感觉「上下滑返回的都不是同一个」。
function peekNext(currentId) {
  if (state.queue.length === 0) return null;
  const idx = state.queue.findIndex((v) => v.id === currentId);
  if (idx === -1) return state.queue[0];
  return state.queue[(idx + 1) % state.queue.length];
}

function peekPrev(currentId) {
  if (state.queue.length === 0) return null;
  const idx = state.queue.findIndex((v) => v.id === currentId);
  if (idx === -1) return state.queue[0];
  return state.queue[(idx - 1 + state.queue.length) % state.queue.length];
}

// ==================== 图片队列 ====================
function buildImageQueue() {
  let pool;
  if (state.selectedFolder === '__all__') {
    pool = state.allImages;
  } else {
    pool = state.allImages.filter((v) => v.folder === state.selectedFolder);
  }
  console.log('[buildImageQueue] folder:', state.selectedFolder, 'pool:', pool.length, 'total images:', state.allImages.length);
  if (state.mode === 'folder-seq') {
    state.imageQueue = pool.slice().sort((a, b) =>
      (a.folder + '/' + a.name).localeCompare(b.folder + '/' + b.name)
    );
  } else {
    // 洗牌列表模式：刷新时生成一次固定顺序的随机队列，可回溯
    state.imageQueue = shuffle(pool);
  }
  state.imageQueueIndex = state.imageQueue.length > 0 ? 0 : -1;
}

function peekNextImage(currentId) {
  if (state.imageQueue.length === 0) return null;
  const idx = state.imageQueue.findIndex((v) => v.id === currentId);
  if (idx === -1) return state.imageQueue[0];
  return state.imageQueue[(idx + 1) % state.imageQueue.length];
}

function peekPrevImage(currentId) {
  if (state.imageQueue.length === 0) return null;
  const idx = state.imageQueue.findIndex((v) => v.id === currentId);
  if (idx === -1) return state.imageQueue[0];
  return state.imageQueue[(idx - 1 + state.imageQueue.length) % state.imageQueue.length];
}

function imgSrcOf(img) {
  return '/api/image/' + img.id;
}

function loadImageSlot(slotName, imgMeta) {
  const img = imgs[slotName];
  if (!imgMeta) {
    if (img.getAttribute('src')) { img.src = ''; img.removeAttribute('src'); }
    state.imageSlots[slotName] = null;
    return;
  }
  state.imageSlots[slotName] = imgMeta;
  // src 相同时跳过，避免重复 set 导致浏览器重请求/闪烁
  const target = imgSrcOf(imgMeta);
  // img.src 会返回完整绝对URL，用 endsWith 匹配路径
  if (img.src && img.src.endsWith(target)) return;
  img.src = target;
}

function showCurrentImage() {
  const cur = state.imageSlots.current;
  if (!cur) return;
  errorBadge.classList.add('hidden');
  updateInfo();
}

function fillImageSlots(centerImg) {
  loadImageSlot('current', centerImg);
  loadImageSlot('next', peekNextImage(centerImg ? centerImg.id : null));
  loadImageSlot('prev', peekPrevImage(centerImg ? centerImg.id : null));
}

// 图片滑动切换：三槽位 + translateY 动画。
// 关键优化：动画结束后不立即重新 set 三个 slot 的 src（会导致闪烁），
// 而是直接在 DOM 元素间复制已解码的 src，只真正加载新的远端边缘 slot。
function goToImage(direction) {
  if (state.animating) return;
  if (state.imageQueue.length <= 1) return;
  state.animating = true;
  feedImage.classList.add('animating');
  // 基准 translateY(-100%) 让 current 显示。向上滑 -> -200%（看 next）；向下滑 -> 0%（看 prev）
  const offsetPct = -100 - direction * 100;
  feedImage.style.transform = `translate3d(0, ${offsetPct}%, 0)`;

  setTimeout(() => {
    let newCurrentMeta, oldCurrentMeta, farMeta;
    if (direction === 1) {
      newCurrentMeta = state.imageSlots.next || peekNextImage(state.imageSlots.current && state.imageSlots.current.id);
      oldCurrentMeta = state.imageSlots.current;
      farMeta = peekNextImage(newCurrentMeta ? newCurrentMeta.id : null);
      // DOM 迁移：next 的图片已在可见位置，直接搬 current/prev 的内容
      // prev <- oldCurrent（搬 current 的 decoded 图像）
      if (imgs.current.src) { imgs.prev.src = imgs.current.src; } else { imgs.prev.removeAttribute('src'); }
      // current <- newCurrent（搬 next 的 decoded 图像）
      if (imgs.next.src) { imgs.current.src = imgs.next.src; } else { imgs.current.removeAttribute('src'); }
      // next <- 新 farMeta（唯一可能需要重新加载的）
      state.imageSlots.prev = oldCurrentMeta;
      state.imageSlots.current = newCurrentMeta;
      state.imageSlots.next = farMeta;
      if (farMeta) {
        const tgt = imgSrcOf(farMeta);
        if (!imgs.next.src || !imgs.next.src.endsWith(tgt)) imgs.next.src = tgt;
      } else {
        imgs.next.removeAttribute('src');
      }
    } else {
      newCurrentMeta = state.imageSlots.prev || peekPrevImage(state.imageSlots.current && state.imageSlots.current.id);
      oldCurrentMeta = state.imageSlots.current;
      farMeta = peekPrevImage(newCurrentMeta ? newCurrentMeta.id : null);
      // DOM 迁移：prev 的图片已在可见位置，搬
      if (imgs.current.src) { imgs.next.src = imgs.current.src; } else { imgs.next.removeAttribute('src'); }
      if (imgs.prev.src) { imgs.current.src = imgs.prev.src; } else { imgs.current.removeAttribute('src'); }
      state.imageSlots.next = oldCurrentMeta;
      state.imageSlots.current = newCurrentMeta;
      state.imageSlots.prev = farMeta;
      if (farMeta) {
        const tgt = imgSrcOf(farMeta);
        if (!imgs.prev.src || !imgs.prev.src.endsWith(tgt)) imgs.prev.src = tgt;
      } else {
        imgs.prev.removeAttribute('src');
      }
    }
    // iOS 兼容：两帧 reset 时序
    feedImage.style.transition = 'none';
    requestAnimationFrame(() => {
      feedImage.style.transform = 'translate3d(0, -100%, 0)';
      requestAnimationFrame(() => {
        feedImage.style.transition = '';
        feedImage.classList.remove('animating');
        state.animating = false;
        showCurrentImage();
        resetImageAutoTimer();
      });
    });
  }, 300);
}

// 图片自动切换定时器
function resetImageAutoTimer() {
  if (state.imageAutoTimer) { clearTimeout(state.imageAutoTimer); state.imageAutoTimer = null; }
  if (state.mediaType !== 'image' || state.imageAutoInterval <= 0) return;
  if (state.imageQueue.length === 0) return;
  state.imageAutoTimer = setTimeout(() => {
    goToImage(1);
  }, state.imageAutoInterval * 1000);
}

function stopImageAutoTimer() {
  if (state.imageAutoTimer) { clearTimeout(state.imageAutoTimer); state.imageAutoTimer = null; }
}

// ==================== 模式切换 ====================
function switchMode(type) {
  if (state.mediaType === type) return;
  state.mediaType = type;
  localStorage.setItem('mediaType', type);

  if (type === 'image') {
    // 清除视频 src，避免遗留 stream 请求 ERR_ABORTED
    Object.values(videos).forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); });
    state.slots = { prev: null, current: null, next: null };
    document.body.classList.add('image-mode');
    feedImage.classList.remove('hidden');
    // 应用图片默认文件夹
    state.selectedFolder = state.defaultImageFolder;
    rebuildAndPlay();
    resetImageAutoTimer();
  } else {
    stopImageAutoTimer();
    document.body.classList.remove('image-mode');
    feedImage.classList.add('hidden');
    // 应用视频默认文件夹
    state.selectedFolder = state.defaultVideoFolder;
    rebuildAndPlay();
  }

  // 更新主页面功能栏按钮状态（只改主页面的）
  funcButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === type);
  });
  // 注意：设置页底部功能栏的高亮由页面本身决定（设置页永远只高亮"设置"按钮），
  // 不跟随 mediaType，所以这里不碰 settingsFuncButtons
  folderSelect.value = state.selectedFolder;
}

funcButtons.forEach((btn) => {
  btn.addEventListener('click', () => switchMode(btn.dataset.mode));
});

btnFuncSettings.addEventListener('click', () => {
  // 打开设置页：暂停视频 + 停止图片自动切换
  if (state.mediaType === 'video') {
    Object.values(videos).forEach((v) => v.pause());
  } else if (state.mediaType === 'image') {
    stopImageAutoTimer();
  }
  document.body.classList.add('settings-open');
  settingsPanel.classList.remove('hidden');
  loadAuthStatus();
});

function closeSettings() {
  settingsPanel.classList.add('hidden');
  document.body.classList.remove('settings-open');
  // 从设置返回主页面：恢复之前的状态（原视频播放/原图片自动切换）
  if (state.mediaType === 'video') {
    playCurrent();
  } else if (state.mediaType === 'image') {
    resetImageAutoTimer();
  }
}

// ==================== 播放控制 ====================
function srcOf(video) {
  return '/api/stream/' + video.id;
}

// ============================================================================
// 🔁 转码模块（函数部分）默认关闭
// - AUTO_CONVERT_ENABLED = false → 所有转码入口直接 return，不再发 POST /api/convert
// - 保留函数本体（不删），将来想启用时只改顶部一个开关即可。
// ============================================================================
function convertSrcOf(video) {
  return '/api/convert/' + video.id;
}
function isConvertSrc(videoEl) {
  return videoEl && videoEl.src && videoEl.src.includes('/api/convert/');
}

function startAutoConvert(videoMeta, reason) {
  // 总开关：关掉后一律不做转码（也不卡 CPU，也不显示转码 UI）
  if (!AUTO_CONVERT_ENABLED) {
    console.debug('[startAutoConvert] SKIP (disabled by AUTO_CONVERT_ENABLED=false)', videoMeta?.name, reason);
    return false;
  }
  if (!ffmpegAvailable) {
    showErrorBadge(reason || 'format-mime', { auto: false, msg: '服务端未启用 ffmpeg，无法自动转码' });
    return false;
  }
  const v = videos.current;
  if (!v || v._loadedId !== videoMeta.id) return false;
  if (_convertingIds.has(videoMeta.id)) return false;
  _convertingIds.add(videoMeta.id);
  console.warn('[startAutoConvert] POSTing convert:', videoMeta.name, 'reason:', reason);
  showErrorBadge(reason || 'format-mime', { auto: true });
  btnConvert.classList.add('hidden');
  convertStatus.classList.remove('hidden');
  convertStatus.textContent = '自动转码中，请稍候…';
  const errTextEl = errorBadge.querySelector('.err-text');
  const errHintEl = errorBadge.querySelector('.err-hint');
  if (errTextEl) errTextEl.textContent = `正在转码：${videoMeta.name}`;
  if (errHintEl) errHintEl.textContent = '大文件需要几十秒到几分钟，请耐心等待；转码完成后会自动切换播放';
  try { v.pause(); } catch(_) {}
  (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12 * 60 * 1000);
      const r = await fetch('/api/convert/' + videoMeta.id, { method: 'POST', signal: controller.signal });
      clearTimeout(timeout);
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || '转码失败');
      const item = state.allVideos.find((x) => x.id === data.old_id);
      if (item) {
        item.id = data.new_id;
        if (data.new_name) item.name = data.new_name;
      }
      state.folders = data.folders;
      updateFolderSelect(data.folders);
      convertStatus.textContent = '转码完成，正在加载…';
      if (errTextEl) errTextEl.textContent = '转码成功';
      if (errHintEl) errHintEl.textContent = `已生成 ${data.new_name || '新的 MP4 文件'}，自动切换播放`;
      _convertingIds.delete(videoMeta.id);
      buildQueue();
      const newIdx = state.queue.findIndex((x) => x.id === data.new_id);
      if (newIdx >= 0) {
        fillSlots(state.queue[newIdx]);
        setTimeout(() => {
          convertStatus.classList.add('hidden');
          errorBadge.classList.add('hidden');
          playCurrent();
        }, 500);
      } else {
        setTimeout(() => {
          convertStatus.classList.add('hidden');
          rebuildAndPlay();
        }, 500);
      }
    } catch (e) {
      _convertingIds.delete(videoMeta.id);
      const msg = (e && e.name === 'AbortError') ? '转码超时（已超过 12 分钟）' : (e.message || '未知错误');
      convertStatus.textContent = '自动转码失败: ' + msg;
      if (errTextEl) errTextEl.textContent = '转码失败';
      if (errHintEl) errHintEl.textContent = msg + '；请刷新重试或检查 ffmpeg 安装是否正常';
      if (AUTO_CONVERT_ENABLED) btnConvert.classList.remove('hidden');
    }
  })();
  return true;
}

function autoSwitchToConvert(videoMeta, reason) {
  return startAutoConvert(videoMeta, reason);
}
// ============================================================================
// 🔁 转码模块（函数部分）结束
// ============================================================================

// 扩展名 → MIME 映射，仅作为 canPlayType 预判的辅助参考（真正硬判靠下方白名单）
const MIME_BY_EXT = {
  '.mp4':  'video/mp4; codecs="avc1.42E01E, mp4a.40.2"', // H.264 Baseline + AAC LC — 浏览器100%支持
  '.m4v':  'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
  '.mov':  'video/quicktime',
  '.webm': 'video/webm; codecs="vp8, vorbis"',
  '.ogv':  'video/ogg; codecs="theora, vorbis"',
  '.ogg':  'video/ogg; codecs="theora, vorbis"',
  '.mkv':  'video/x-matroska',
  '.avi':  'video/x-msvideo',
  '.wmv':  'video/x-ms-wmv',
  '.flv':  'video/x-flv',
  '.f4v':  'video/mp4',
  '.3gp':  'video/3gpp',
  '.m2ts': 'video/mp2t',
  '.ts':   'video/mp2t',
};

// 浏览器原生支持的「容器白名单」：只有这些扩展名才有资格走 canPlayType 预判。
// 不在白名单里的（avi/mkv/wmv/rmvb/flv/3gp/m2ts/dat/vob 等）一律直接判 false，
// 强制走转码流程 — 彻底避免 canPlayType('video/x-msvideo') 某些版本返回
// 'maybe' 让我们误判「可能支持」，结果 avi 走到 play() 被 reject 用户还要手动点转码。
const NATIVE_CONTAINER_WHITELIST = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.ogg']);

function canBrowserPlay(meta) {
  if (!meta || !meta.name) return true;
  const ext = meta.name.slice(meta.name.lastIndexOf('.')).toLowerCase();
  if (!NATIVE_CONTAINER_WHITELIST.has(ext)) return false;
  const mime = MIME_BY_EXT[ext];
  // 白名单里但没对应的 MIME（理论上不会）→ 放行让它试播
  if (!mime) return true;
  const res = document.createElement('video').canPlayType(mime);
  // '' = 明确不支持 → 直接转码；'maybe'/'probably' → 放行（但 loadedmetadata 里还会用 videoWidth===0 兜底）
  if (res === '') return false;
  return true;
}

function loadSlot(slotName, videoMeta) {
  const v = videos[slotName];
  v.onerror = null;
  v.ontimeupdate = null;
  v.onprogress = null;
  v.onloadedmetadata = null;
  if (v._errorTimer) { clearTimeout(v._errorTimer); v._errorTimer = null; }
  if (!videoMeta) {
    v.pause();
    // 先置 src 为空字符串，浏览器会立刻 abort 上一个请求（避免旧请求继续耗带宽）。
    try { v.src = ''; } catch(_) {}
    try { v.removeAttribute('src'); } catch(_) {}
    try { v.load(); } catch(_) {}
    state.slots[slotName] = null;
    v._loadedId = null;
    return;
  }
  // 【关键：相同 ID 绝不重设 src】—— 防止"滑动动画回调 + fillSlots 组合拳"里
  // 对同一个 slot 短时间连设两次相同 src，浏览器会 abort 掉第一个还没发完响应的请求
  // → 触发 net::ERR_ABORTED 并且 play() Promise 被拒绝，最终 current 也黑屏。
  if (v._loadedId === videoMeta.id) {
    // 还是要把 meta 同步（用户可能中途发生过重命名/移动等），id 不变说明 abs_path 相同
    state.slots[slotName] = videoMeta;
    if (slotName === 'current') bindProgressEvents(v, slotName);
    return;
  }
  state.slots[slotName] = videoMeta;
  v._loadedId = videoMeta.id;
  console.log(`[loadSlot:${slotName}]`, videoMeta.name, '->', srcOf(videoMeta));
  // 所有 slot 默认 preload=none，绝不自动"提前"加载。
  // 只有 current 在 play() 真正触发后才会发请求，
  // prev/next 保持空请求，避免和 current 抢带宽造成并发 abort。
  v.preload = 'none';
  v.muted = state.muted;

  // 【关键 2：暂停后再改 src】
  // 若视频正在播放，改 src 前先 pause() → 浏览器不会在"还在播放流时被切 src"
  // 直接 abort 导致 play() Promise 崩掉。
  try { v.pause(); } catch(_) {}

  const newSrc = srcOf(videoMeta);
  // 【关键 3：清空 src → 下一帧再赋新 src】
  // 用 0ms setTimeout + requestAnimationFrame 把赋值切成两次微任务，
  // 让浏览器把"上一个流的 abort 动作"和"发起新请求"彻底分开两帧完成，
  // 完全杜绝 A 请求还在握手/重定向阶段就被 B 请求覆盖 → ERR_ABORTED。
  try { v.src = ''; } catch(_) {}
  try { v.removeAttribute('src'); } catch(_) {}
  // 只有 current 需要立即触发加载；prev/next 完全不加载
  if (slotName === 'current') {
    requestAnimationFrame(() => {
      // 二次校验：到 rAF 这帧时 id 必须仍是同一个（防止用户又换了视频）
      if (v._loadedId !== videoMeta.id) return;
      v.preload = 'auto';   // current 正常加载
      v.src = newSrc;
      // 预判格式支持：容器级 MIME 黑名单（如 avi/mkv 在某些 Linux 容器浏览器里被直接拒绝）
      // 注意：mp4 容器 canPlayType='probably' 不等于真能解视频流！H.265/HEVC 视频 + AAC
      // 音频的 mp4，Chrome/Safari 都会返回 probably/maybe，但实际 videoWidth=0（只有音轨）。
      // 真正的视频解码检测放在 onloadedmetadata（videoWidth===0）里。
      if (!canBrowserPlay(videoMeta)) {
        // 【自动转码点 1】容器白名单外 / canPlayType 明确判 false → 直接转码，不再让用户手动点
        console.warn('[video] canPlayType 明确不支持该容器 → 自动转码', videoMeta.name);
        startAutoConvert(videoMeta, 'format-mime');
        try { v.pause(); } catch(_) {}
        return;
      }
      v.onerror = () => {
        const code = v.error && v.error.code;
        console.error('[video error]', v.error, 'code=', code, 'src=', v.src);
        // 4 = MEDIA_ERR_SRC_NOT_SUPPORTED = 浏览器明确说「格式不支持」
        // 【自动转码点 2】code=4 直接转码；其它未知错误保留徽标+手动按钮兜底
        if (code === 4) {
          startAutoConvert(videoMeta, 'format-mime');
        } else {
          showErrorBadge('unknown');
        }
        try { v.pause(); } catch(_) {}
      };
      // 兜底：4 秒内没进入 readyState>=2 且未暂停，疑似无法解码
      if (v._errorTimer) clearTimeout(v._errorTimer);
      v._errorTimer = setTimeout(() => {
        if (v.readyState < 2 && !v.paused) {
          console.warn('[video] 4s 无画面，疑似无法解码', v.src);
          showErrorBadge('timeout');
        }
      }, 4000);
      bindProgressEvents(v, slotName);
    });
  } else {
    // prev / next：既不设 src 也不 load，等真正被 promote 为 current 时再去请求。
    // 这样"一个视频切换 = 只并发 1 个 HTTP 流请求"，永远不会触发多请求互 abort 的 ERR_ABORTED。
  }
}

// 是否已获得用户手势授权（首次交互后才能带声音播放）
let userInteracted = false;
['touchstart', 'mousedown', 'keydown'].forEach((evt) => {
  window.addEventListener(evt, () => { userInteracted = true; }, { once: true, capture: true });
});

// 播放失败徽标：简洁说明原因（不再提示转码 — 转码默认关闭，越转越卡）
// reason: 'format-mime' | 'video-zero-size' | 'play-rejected' | 'timeout' | 'unknown'
function showErrorBadge(reason) {
  errorBadge.classList.remove('hidden');
  btnConvert.classList.add('hidden');
  convertStatus.classList.add('hidden');
  const errText = errorBadge.querySelector('.err-text');
  const errHint = errorBadge.querySelector('.err-hint');
  let msg = '播放失败';
  let hint = '浏览器无法播放当前视频（格式/编码不兼容），请切到下一个';
  switch (reason) {
    case 'video-zero-size':
      msg = '浏览器无法解码此视频画面（声音正常）';
      hint = '常见原因：H.265/HEVC / H.264 10-bit / AV1 等浏览器不支持的视频编码。建议用桌面播放器（VLC/PotPlayer）播放，或本地转成 H.264 MP4 再放入 videos 目录。';
      break;
    case 'format-mime':
      msg = '浏览器不支持该容器格式';
      hint = '常见于 .mkv / .avi / .wmv / .rmvb / .flv 等容器。建议转成 .mp4 (H.264+AAC) 后再看。';
      break;
    case 'play-rejected':
      msg = '播放被拒绝（视频无法解码）';
      hint = '可能是编码或容器不兼容，请切换其他视频。';
      break;
    case 'timeout':
      msg = '长时间无画面，疑似无法解码';
      hint = '文件可能损坏或编码不兼容，请切换其他视频。';
      break;
  }
  if (errText) errText.textContent = msg;
  if (errHint) errHint.textContent = hint;
}

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
    // 【自动转码点 4 — 兜底 zero-size】play() 成功但画宽=0 = 声音正常画面黑屏
    //   （H.265/HEVC、H.264-10bit、AV1 等浏览器无法解视频帧的编码）
    //   3000 实锤文件：HEYZO-2110【中文字幕】.mp4 — 能 play() 成功（音频通）但解码不出帧。
    //   loadedmetadata 已截过一层，这里再补一次保证不漏网 → 直接自动转码。
    if (v.videoWidth === 0 && v.videoHeight === 0 && isFinite(v.duration) && v.duration > 0) {
      console.warn('[playCurrent] PLAY OK BUT ZERO-SIZE FALLBACK → startAutoConvert');
      startAutoConvert(cur, 'video-zero-size');
    }
    if (userInteracted && !state.muted) v.muted = false;
    // 全屏时切换视频：如果方向变化（横屏↔竖屏），重新锁定屏幕方向
    if (isFullscreen()) lockOrientationByVideo();
  }).catch((err) => {
    // 过滤正常预期内的打断：切视频太快时旧 play() 被新 load/pause 打断
    if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
      console.debug('[playCurrent] PLAY CANCELED (ok)', err?.name, err?.message || '');
      return;
    }
    console.error('[playCurrent] PLAY REJECTED', err?.name || err, err?.message || '');
    // 【自动转码点 5】NotSupportedError = 浏览器明确说「我没法解码这个流」→ 直接转码
    if (err && err.name === 'NotSupportedError') {
      startAutoConvert(cur, 'format-mime');
    }
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

// 双击恢复1倍速，单击延迟判定以区分双击
function handleTap() {
  if (state.mediaType === 'image') {
    // 图片模式：单击切换 UI 显示/隐藏
    const now = Date.now();
    if (now - lastTapTime < DOUBLE_TAP_MS) {
      // 双击 → 什么也不做（暂不实现缩放）
      if (singleTapTimer) { clearTimeout(singleTapTimer); singleTapTimer = null; }
      lastTapTime = 0;
    } else {
      lastTapTime = now;
      singleTapTimer = setTimeout(() => {
        singleTapTimer = null;
        state.uiHidden = !state.uiHidden;
        document.body.classList.toggle('ui-hidden', state.uiHidden);
      }, DOUBLE_TAP_MS);
    }
    return;
  }
  // 视频模式：原有逻辑
  const now = Date.now();
  if (now - lastTapTime < DOUBLE_TAP_MS) {
    // 双击 → 恢复1倍速
    if (singleTapTimer) { clearTimeout(singleTapTimer); singleTapTimer = null; }
    lastTapTime = 0;
    const v = videos.current;
    if (!v) return;
    v.playbackRate = 1;
    speedBadge.textContent = '1×';
    speedBadge.classList.add('show');
    setTimeout(() => speedBadge.classList.remove('show'), 800);
  } else {
    // 可能是单击，延迟执行以等待第二次点击
    lastTapTime = now;
    singleTapTimer = setTimeout(() => {
      singleTapTimer = null;
      togglePlay();
    }, DOUBLE_TAP_MS);
  }
}

function syncPlayBadge() {
  const v = videos.current;
  // 长按 seek 模式下暂停视频不显示暂停按钮
  if (state.isLongPressing && state.longPressMode === 'seek') {
    playBadge.classList.remove('show');
    return;
  }
  if (v && v.paused && state.slots.current) {
    playBadge.classList.add('show');
  } else {
    playBadge.classList.remove('show');
  }
}

function updateInfo() {
  if (state.mediaType === 'image') {
    const cur = state.imageSlots.current;
    if (!cur) {
      indicator.textContent = '没有图片';
      infoEl.textContent = '请把图片放入 ./videos 目录';
      return;
    }
    const idx = state.imageQueue.findIndex((v) => v.id === cur.id);
    indicator.textContent =
      `${idx >= 0 ? idx + 1 : '?'} / ${state.imageQueue.length} · ${cur.folder}`;
    infoEl.textContent = cur.name;
    return;
  }
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
// 【v68：folder-random = 洗牌列表模式】
//   刷新时已经 shuffle 成固定顺序数组写入 state.queue，顺序不会再变，
//   所以 folder-seq / folder-random 两个模式**逻辑完全一样**：
//   1) 先只加载 current 的 src（带宽独占，prev/next 只写 meta 不发起 HTTP 请求）
//   2) 立即把 next/prev 的 meta 写入 state.slots，保证用户快速上下滑时，
//      state.slots.next / state.slots.prev 一定能拿到正确的相邻项，
//      不会因为 scheduleFillAdjacent 延迟 200ms 未执行而退化成 peekNext/peekPrev。
//   3) scheduleFillAdjacent 在 current loadedmetadata 后 200ms 才真正填相邻槽的 src
//   好处：上滑到 idx+1 再下滑回 idx-1，一定返回到同一个视频 = 可回溯。
function fillSlots(centerVideo) {
  // 取消上一次还没执行的"相邻槽预填"（用户短时间内连续滑动的情况）
  if (state._pendingFillAdj) { clearTimeout(state._pendingFillAdj); state._pendingFillAdj = null; }
  // 当前视频优先加载 src
  loadSlot('current', centerVideo);

  // 顺序 + 洗牌模式：都立即把相邻项 meta 写入 state.slots（但 loadSlot 内部
  // 对非 current slot 只会写 meta，不会设 src 发 HTTP 请求，带宽安全）
  const nextV = peekNext(centerVideo ? centerVideo.id : null);
  const prevV = peekPrev(centerVideo ? centerVideo.id : null);
  const safeNext = (nextV && nextV.id === (centerVideo && centerVideo.id)) ? null : nextV;
  const safePrev = (prevV && prevV.id === (centerVideo && centerVideo.id)) ? null : prevV;
  // 写 meta（非 current slot = 不发 HTTP 请求，只填充 slots 对象）
  if (safeNext) loadSlot('next', safeNext);
  else state.slots.next = null;
  if (safePrev) loadSlot('prev', safePrev);
  else state.slots.prev = null;
  // 同时缓存 _adjacent（给 scheduleFillAdjacent 用）
  state._adjacent = { next: safeNext, prev: safePrev };
}

// current loadedmetadata 成功后调用：延迟 200ms 填相邻槽（不分模式，统一带宽串行化）
function scheduleFillAdjacent(currentMetaId) {
  if (state._pendingFillAdj) { clearTimeout(state._pendingFillAdj); state._pendingFillAdj = null; }
  const adj = state._adjacent;
  if (!adj) return;
  state._pendingFillAdj = setTimeout(() => {
    state._pendingFillAdj = null;
    const v = videos.current;
    if (!v || v._loadedId !== currentMetaId) return;
    if (adj.next) loadSlot('next', adj.next);
    if (adj.prev) loadSlot('prev', adj.prev);
  }, 200);
}

// ==================== 滑动切换 ====================
function goTo(direction) {
  // direction: 1 = 下一个（向上滑）, -1 = 上一个（向下滑）
  if (state.animating) return;
  if (state.queue.length <= 1) return;

  state.animating = true;
  feed.classList.add('animating');
  const offsetPct = -100 - direction * 100;
  feed.style.transform = `translateY(${offsetPct}%)`;

  setTimeout(() => {
    // 【v68：folder-random 洗牌后 = 固定顺序，folder-seq 同逻辑】
    //   所有「下一个/上一个」来源统一走 peekNext/peekPrev → 基于 queue findIndex + 相邻下标
    //   绝对不依赖 pickRandom 或 slots.next/prev 可能过期的缓存，保证可回溯。
    //   slots.next/prev 只用于加速（有就直接用，无则退回 peek，两者结果应完全一致）
    const curId = state.slots.current && state.slots.current.id;
    let newCurrent, oldCurrent, farNext, farPrev;
    if (direction === 1) {
      newCurrent = peekNext(curId);   // 直接基于 queue 取相邻，不依赖 slots.next 缓存
      oldCurrent = state.slots.current;
      // 新 current 的「更下一个」= farNext（对应新三槽的 next）
      farNext = peekNext(newCurrent ? newCurrent.id : null);
      // 把 oldCurrent 直接挪为 prev，保证下滑立刻能回到原视频（精确可回溯）
      loadSlot('prev', oldCurrent);
      loadSlot('current', newCurrent);
      loadSlot('next', farNext);
      // 同步 _adjacent：当前 current 是 newCurrent，相邻是 prev=oldCurrent, next=farNext
      state._adjacent = {
        prev: oldCurrent,
        next: farNext,
      };
    } else {
      newCurrent = peekPrev(curId);   // 直接基于 queue 取相邻，不依赖 slots.prev 缓存
      oldCurrent = state.slots.current;
      // 新 current 的「更上一个」= farPrev（对应新三槽的 prev）
      farPrev = peekPrev(newCurrent ? newCurrent.id : null);
      // 把 oldCurrent 直接挪为 next，保证上滑立刻能回到原视频（精确可回溯）
      loadSlot('next', oldCurrent);
      loadSlot('current', newCurrent);
      loadSlot('prev', farPrev);
      // 同步 _adjacent：当前 current 是 newCurrent，相邻是 prev=farPrev, next=oldCurrent
      state._adjacent = {
        prev: farPrev,
        next: oldCurrent,
      };
    }
    videos.prev.pause();
    videos.next.pause();
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
// 说明：所有触摸/鼠标事件统一挂在 #touch-layer（全屏透明层）上，
// 完全不经过 video 元素，彻底避免 iOS/华为/桌面端与 video 自带手势冲突。

const SWIPE_THRESHOLD = 70;      // 滑动触发距离（px）
const MOVE_THRESHOLD = 20;       // 判定为"移动过"的阈值（与单击区分）
const LONG_PRESS_MS = 500;       // 长按判定时间
const DOUBLE_TAP_MS = 300;       // 双击间隔判定
// seek 节流：66ms ≈ 15fps，手机解码+绘制的甜点节奏。rAF 60fps下每4帧真正seek一次。
const SEEK_THROTTLE_MS = 66;
const IS_TOUCH = 'ontouchstart' in window;
let gesture = null;
let lastTapTime = 0;
let singleTapTimer = null;

// --- 触摸事件 ---
// 双指外滑 → 显示/隐藏所有按钮
let pinchInitialDist = 0;
touchLayer.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    pinchInitialDist = Math.sqrt(dx * dx + dy * dy);
    // 取消单指手势
    cancelLongPress();
    gesture = null;
    e.preventDefault();
    return;
  }
  if (e.touches.length !== 1) return;
  if (singleTapTimer) { clearTimeout(singleTapTimer); singleTapTimer = null; }
  const t = e.touches[0];
  gesture = {
    phase: 'start',
    x: t.clientX, y: t.clientY,
    moved: false, wasLongPress: false,
  };
  startLongPress();
  e.preventDefault();
}, { passive: false });

touchLayer.addEventListener('touchmove', (e) => {
  // 双指手势跟踪：外滑隐藏、内滑恢复
  if (e.touches.length === 2 && pinchInitialDist > 0) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const delta = dist - pinchInitialDist;
    if (delta > 40) {
      // 外滑（双指张开）→ 隐藏 UI
      state.uiHidden = true;
      document.body.classList.add('ui-hidden');
      pinchInitialDist = 0;
    } else if (delta < -40) {
      // 内滑（双指合拢）→ 恢复 UI
      state.uiHidden = false;
      document.body.classList.remove('ui-hidden');
      pinchInitialDist = 0;
    }
    e.preventDefault();
    return;
  }
  if (!gesture || gesture.phase !== 'start') return;
  const t = e.touches[0];
  const dx = t.clientX - gesture.x;
  const dy = t.clientY - gesture.y;
  // 长按已激活 → 处理拖拽（进度/变速），不取消长按
  if (state.isLongPressing) {
    handleLongPressDrag(t.clientX, t.clientY);
    e.preventDefault();
    return;
  }
  if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) {
    gesture.moved = true;
    cancelLongPress();
  }
  e.preventDefault();
}, { passive: false });

touchLayer.addEventListener('touchend', (e) => {
  // 双指手势结束时重置
  if (pinchInitialDist > 0 && e.touches.length < 2) {
    pinchInitialDist = 0;
  }
  if (!gesture) return;
  const wasLongPress = state.isLongPressing;
  cancelLongPress();
  const t = e.changedTouches[0];
  const dx = t.clientX - gesture.x;
  const dy = t.clientY - gesture.y;
  if (gesture.moved) {
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx > ady && adx > SWIPE_THRESHOLD) {
      // 向左滑 dx<0 = 移动当前文件到其他文件夹；向右滑 dx>0 = 弹删除确认
      if (dx > 0) showDeleteModal();
      else showMovePanel();
    } else if (ady > SWIPE_THRESHOLD) {
      if (state.mediaType === 'image') goToImage(dy < 0 ? 1 : -1);
      else goTo(dy < 0 ? 1 : -1);
    }
    // 移动过但不够滑动阈值 → 视为误操作，不触发任何动作
  } else if (!wasLongPress) {
    // 没移动过且非长按 → 单击/双击
    handleTap();
  }
  gesture = null;
  e.preventDefault();
}, { passive: false });

touchLayer.addEventListener('touchcancel', (e) => {
  cancelLongPress();
  gesture = null;
  e.preventDefault();
}, { passive: false });

// --- 鼠标事件（桌面端）---
touchLayer.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (singleTapTimer) { clearTimeout(singleTapTimer); singleTapTimer = null; }
  gesture = {
    phase: 'start',
    x: e.clientX, y: e.clientY,
    moved: false, wasLongPress: false,
  };
  startLongPress();
});

window.addEventListener('mousemove', (e) => {
  if (!gesture || gesture.phase !== 'start') return;
  const dx = e.clientX - gesture.x;
  const dy = e.clientY - gesture.y;
  // 长按已激活 → 处理拖拽（进度/变速），不取消长按
  if (state.isLongPressing) {
    handleLongPressDrag(e.clientX, e.clientY);
    return;
  }
  if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) {
    gesture.moved = true;
    cancelLongPress();
  }
});

window.addEventListener('mouseup', (e) => {
  if (!gesture) return;
  if (e.button !== 0) { gesture = null; return; }
  const wasLongPress = state.isLongPressing;
  cancelLongPress();
  const dx = e.clientX - gesture.x;
  const dy = e.clientY - gesture.y;
  if (gesture.moved) {
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx > ady && adx > SWIPE_THRESHOLD) {
      // 向左滑 dx<0 = 移动当前文件到其他文件夹；向右滑 dx>0 = 弹删除确认
      if (dx > 0) showDeleteModal();
      else showMovePanel();
    } else if (ady > SWIPE_THRESHOLD) {
      if (state.mediaType === 'image') goToImage(dy < 0 ? 1 : -1);
      else goTo(dy < 0 ? 1 : -1);
    }
  } else if (!wasLongPress) {
    handleTap();
  }
  gesture = null;
});

window.addEventListener('mouseleave', cancelLongPress);

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

// ==================== seek 预览（手机端 canvas + requestAnimationFrame 循环） ====================
// 关键优化：不再等 seeked 事件后才画。
// - pointermove/拖拽只更新"目标时间 state._targetSeekTime"
// - rAF 循环按 60fps 运行：
//   1) 无条件 drawSeekFrameNow() → 哪怕当前帧还没解码好，也先画 buffer 里已有的，
//      画面绝不会出现"拖半天完全不动"，体感"跟手"。
//   2) 间隔超过 SEEK_THROTTLE_MS 且 目标时间≠当前实际播放时间 → 真正 seek
// 这样把"UI 跟手"和"解码节奏"完全解耦。

let _seekRafId = 0;
let _seekLastDrawTime = 0;

function startSeekPreview(v) {
  if (!IS_TOUCH || !seekCanvas || !seekCtx || !v) return;
  // 限制 canvas DPR 最高 1.5：超高清屏像素量是 DPR² 倍，手机 GPU 太吃力但肉眼几乎看不出差别。
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  if (seekCanvas.width !== w || seekCanvas.height !== h) {
    seekCanvas.width = w;
    seekCanvas.height = h;
  }
  seekCanvas.classList.add('active');
  // 初始化目标时间
  state._targetSeekTime = v.currentTime || 0;
  state._lastCommittedSeekTime = state._targetSeekTime; // 上次真正执行seek时的目标时间（不是v.currentTime！）
  state._lastSeekTime = 0;
  // 启动 rAF 循环
  cancelAnimationFrame(_seekRafId);
  _seekLastDrawTime = performance.now();
  const loop = () => {
    const now = performance.now();
    // 1) 无条件先画 → 保证手指每移动一帧画面都"有点变化"，绝不卡死不动
    if (seekCtx && seekCanvas && v && v.videoWidth && v.videoHeight) {
      try { drawSeekFrameNow(v); } catch(_) {}
    }
    _seekLastDrawTime = now;
    // 2) 到节流间隔 + 目标时间相对上次真正seek已变化 ≥ 10ms → 真正 set currentTime
    //    注意：跟 v.currentTime 比会因为解码器内部延后更新导致后退小步 seek 被"吃掉"；
    //    必须跟"上次真正seek时的目标时间"比。
    if (typeof state._targetSeekTime === 'number' && v.duration && isFinite(v.duration)) {
      const delta = state._targetSeekTime - (state._lastCommittedSeekTime || 0);
      if (!state._lastSeekTime || now - state._lastSeekTime >= SEEK_THROTTLE_MS) {
        if (Math.abs(delta) > 0.01) { // 10ms 阈值：慢速小步拖拽也不漏
          state._lastSeekTime = now;
          state._lastCommittedSeekTime = state._targetSeekTime;
          const target = Math.max(0, Math.min(v.duration, state._targetSeekTime));
          // 关键：回退 seek（delta < -0.15s）需要 decoder flush，否则 H.264 解码器
          // 缓存的是未来帧，直接跳到过去可能解码不出画面。
          // 做法：先 seek 到"目标前 1 秒且必须在 keyframe 之前"的位置，
          // 下一 rAF 循环会再把 currentTime 拉回 target，等于强制 decoder 重新启动。
          if (delta < -0.15) {
            const flushPoint = Math.max(0, target - 1.0);
            try { v.currentTime = flushPoint; } catch(_) {}
            // 记录 flush，下一帧立刻 seek 回 target
            state._pendingSeekFlush = target;
          } else if (state._pendingSeekFlush !== undefined) {
            // 上帧做了 flush，本帧回落到 target 位置
            try { v.currentTime = state._pendingSeekFlush; } catch(_) {}
            state._pendingSeekFlush = undefined;
          } else {
            try { v.currentTime = target; } catch(_) {}
          }
        } else if (state._pendingSeekFlush !== undefined) {
          // 即使未达阈值，flush 回落也要按时执行
          try { v.currentTime = state._pendingSeekFlush; } catch(_) {}
          state._pendingSeekFlush = undefined;
          state._lastSeekTime = now;
        }
      }
    }
    _seekRafId = requestAnimationFrame(loop);
  };
  _seekRafId = requestAnimationFrame(loop);
  // 先画一帧当前画面打底
  try { drawSeekFrameNow(v); } catch(_) {}
}

function drawSeekFrameNow(v) {
  if (!seekCtx || !seekCanvas || !v) return;
  const w = seekCanvas.width, h = seekCanvas.height;
  if (!w || !h || !v.videoWidth || !v.videoHeight) return;
  seekCtx.fillStyle = '#000';
  seekCtx.fillRect(0, 0, w, h);
  // 模拟 object-fit: contain，保持宽高比居中
  const vw = v.videoWidth, vh = v.videoHeight;
  const scale = Math.min(w / vw, h / vh);
  const dw = vw * scale, dh = vh * scale;
  const dx = (w - dw) / 2, dy = (h - dh) / 2;
  try { seekCtx.drawImage(v, dx, dy, dw, dh); } catch(_) {}
}

function stopSeekPreview() {
  cancelAnimationFrame(_seekRafId);
  _seekRafId = 0;
  state._pendingSeekFlush = undefined;
  if (seekCanvas) seekCanvas.classList.remove('active');
  if (seekCtx && seekCanvas) {
    try { seekCtx.clearRect(0, 0, seekCanvas.width, seekCanvas.height); } catch(_) {}
  }
}

// 兼容函数：外部调用时统一更新 targetSeekTime，由 rAF 循环处理真正 seek + draw
function scheduleSeekDraw(v) {
  if (!IS_TOUCH) return;
  if (v && typeof v.currentTime === 'number') {
    state._targetSeekTime = v.currentTime;
  }
}

// 外部设置目标 seek 时间（全屏长按拖拽 / 底部进度条拖拽统一调用）
function setTargetSeekTime(newTime) {
  state._targetSeekTime = newTime;
}

// ==================== 长按（2x速 + 拖拽进度/变速） ====================
// pureLongPress = true 时，松手恢复 1x（纯长按2倍速）
// 用户一旦开始拖拽（超过阈值），pureLongPress = false，走原有的拖拽变速/进度逻辑，松手不恢复
function startLongPress() {
  if (state.mediaType === 'image') return;  // 图片模式无长按
  cancelLongPress();
  state.longPressTimer = setTimeout(() => {
    const v = videos.current;
    if (!v || v.readyState === 0) return;
    state.isLongPressing = true;
    state.longPressMode = null;
    state.pureLongPress = true;
    state.originalRate = v.playbackRate || 1;
    state.wasPlayingBeforeSeek = !v.paused;  // 记录是否在播放，seek 结束后恢复
    // 长按激活立即给 2 倍速（纯长按 2x），但不显示 badge（不挡画面）
    v.playbackRate = 2;
    // 记录拖拽起始状态
    state.dragStartX = gesture ? gesture.x : 0;
    state.dragStartY = gesture ? gesture.y : 0;
    state.dragStartTime = v.currentTime || 0;
    state.dragStartRateIdx = SPEED_LEVELS.indexOf(state.originalRate);
    if (state.dragStartRateIdx < 0) state.dragStartRateIdx = DEFAULT_SPEED_INDEX;
  }, LONG_PRESS_MS);
}

function cancelLongPress() {
  if (state.longPressTimer) {
    clearTimeout(state.longPressTimer);
    state.longPressTimer = null;
  }
  if (state.isLongPressing) {
    const v = videos.current;
    const wasSeek = state.longPressMode === 'seek';
    // 纯长按 / 进度拖拽：松手恢复原始倍速；仅变速模式保留用户设定的倍速
    if ((state.pureLongPress || wasSeek) && v) {
      v.playbackRate = state.originalRate || 1;
    }
    // seek 模式松手后恢复播放状态
    if (wasSeek && v && state.wasPlayingBeforeSeek) {
      v.play().catch(() => {});
    }
    // 关闭 canvas 预览（手机端）
    stopSeekPreview();
    state.isLongPressing = false;
    state.longPressMode = null;
    state.pureLongPress = false;
    speedBadge.classList.remove('show');
    progressBar.classList.remove('dragging');
  }
}

// 长按激活后的拖拽处理：左右=进度条，上下=变速
function handleLongPressDrag(curX, curY) {
  const v = videos.current;
  if (!v) return;
  const dx = curX - state.dragStartX;
  const dy = curY - state.dragStartY;

  // 首次显著移动时确定模式（水平=seek，垂直=speed）
  if (!state.longPressMode) {
    if (Math.abs(dx) < MOVE_THRESHOLD && Math.abs(dy) < MOVE_THRESHOLD) return;
    state.longPressMode = Math.abs(dx) > Math.abs(dy) ? 'seek' : 'speed';
    state.pureLongPress = false;  // 一旦开始拖拽，不再是纯长按，松手不恢复原倍速
    // 进入 seek 模式统一暂停视频 + 启动 canvas 预览循环（手机端）
    if (state.longPressMode === 'seek') {
      if (!v.paused) v.pause();
      startSeekPreview(v);
    }
  }

  if (state.longPressMode === 'seek') {
    if (!v.duration || !isFinite(v.duration)) return;
    const pct = dx / window.innerWidth;
    const newTime = Math.max(0, Math.min(v.duration, state.dragStartTime + pct * v.duration));
    // 进度条+时间文字：每次 touchmove 都更新，保证视觉 60fps 跟手
    progressBar.classList.add('dragging');
    progressPlayed.style.width = (newTime / v.duration * 100) + '%';
    progressThumb.style.left = (newTime / v.duration * 100) + '%';
    timeCurrent.textContent = formatTime(newTime);
    speedBadge.textContent = formatTime(newTime) + ' / ' + formatTime(v.duration);
    speedBadge.classList.add('show');
    // 只更新目标时间，不直接 set currentTime。
    // 手机端：rAF 循环按 60fps 画 + 每 66ms 真正 seek 一次
    // PC 端：startSeekPreview 是空操作，但还是用 setTargetSeekTime → 统一接口，
    //   PC 暂停态下 currentTime 变化会立刻渲染帧，所以我们在每次 move 时直接 seek 一下。
    if (IS_TOUCH) {
      setTargetSeekTime(newTime);
    } else {
      // PC 端：无节流，跟手度最高
      if (!v.paused || Math.abs(newTime - v.currentTime) > 0.01) {
        v.currentTime = newTime;
      }
    }
    updateProgress(v);
  } else if (state.longPressMode === 'speed') {
    const step = 50;
    const levelDelta = Math.round(-dy / step);
    let newIdx = state.dragStartRateIdx + levelDelta;
    newIdx = Math.max(0, Math.min(SPEED_LEVELS.length - 1, newIdx));
    const newRate = SPEED_LEVELS[newIdx];
    v.playbackRate = newRate;
    speedBadge.textContent = newRate + '×';
    speedBadge.classList.add('show');
  }
}

// ==================== 删除 / 移动 / 新建文件夹 ====================
// 左侧文件夹面板（向右滑打开）：浏览所有文件夹，点击直接切换当前目录播放
function showLeftPanel() {
  renderLeftFolderList();
  // 【z-index 兜底】即使 CSS 里被旧规则重复定义把 z-index 覆盖成 200，
  // JS 里也会强制再升到 9999，保证无论 TRAE 内嵌预览 / NAS 远程桌面浏览器
  // / iOS WKWebView / 任何堆叠上下文下都不会被 #app / <video> 压在底下
  // （v62 就吃了 CSS 重复定义的大亏，用户反馈「左滑啥都看不到」长达多轮；
  //   v67 又发现之前把删除确认弹窗塞 #left-panel 里了，根本没 folder-list 容器）
  leftPanel.style.setProperty('z-index', '9999', 'important');
  leftPanel.classList.remove('hidden');
}

// 删除确认弹窗：点击「删除」按钮时弹出，不再占用 #left-panel
function showDeleteModal() {
  deleteModal.style.setProperty('z-index', '9999', 'important');
  deleteModal.classList.remove('hidden');
}

function showMovePanel() {
  const cur = state.mediaType === 'image' ? state.imageSlots.current : state.slots.current;
  if (!cur) return;
  movePanel.style.setProperty('z-index', '9999', 'important');
  movePanel.classList.remove('hidden');              // 先显示面板（父 display:flex，有真实尺寸）
  // 下一个 tick 再渲染，确保浏览器已完成面板可见的布局（display:none → flex 切换完成）
  // 避免在 display:none 时渲染 DOM 导致 flex 高度算 0，NAS 远程桌面/旧 Safari 尤为严重
  requestAnimationFrame(() => requestAnimationFrame(() => {
    renderMoveFolderList();
  }));
}

// 归一化 folder 字段：兼容"旅行/2024夏天"和"/旅行/2024夏天"两种格式，
// 去掉前导 '/'，返回渲染时需要的 parts/depth/leafName/indent/前缀。
// 之前如果 folder 异常带前导 '/'，split('/')[0] 会是空字符串，导致 parts.length 比真实多 1，
// 缩进错 + sortedFolders 按字符串比大小时 '/' (ASCII 47) 排在所有中文字符前，父子顺序错位 → 看起来像"只有根目录"。
function parseFolderDisplay(folder) {
  let normalized = folder == null ? '' : String(folder);
  if (normalized !== '/' && normalized.startsWith('/')) normalized = normalized.slice(1);
  if (normalized === '/' || normalized === '') {
    return { normalized: '/', parts: [], depth: 0, leafName: '', indentPx: 0, prefix: '', displayPath: '/' };
  }
  const parts = normalized.split('/').filter((p) => p.length > 0); // 过滤空段（防连续斜杠）
  const depth = parts.length;
  const leafName = parts[parts.length - 1];
  const indentPx = 16 * (depth - 1);
  const prefix = depth > 1 ? '└ ' : '';
  return { normalized, parts, depth, leafName, indentPx, prefix, displayPath: '/' + normalized };
}

// 前端兜底：NAS/Windows/macOS 系统垃圾目录黑名单（与后端 server.py 的 SKIP_DIRS 对应）
const FOLDER_SKIP_SEGMENTS = new Set([
  '@eaDir', '@eadir', '@Recently-Snapshot', '@recycle', '#recycle',
  '@sharebin', '@tmp', '#snapshot', '@S2S', '$RECYCLE.BIN', '$Recycle.Bin',
  'System Volume Information', 'lost+found',
  '.thumbnails', '.thumb', '.thumbs',          // 各种缩略图缓存目录
  '._DAV',                                      // macOS Finder SMB/WebDAV 自动创建的 Apple Double 资源叉伪目录
  '.cache', '__MACOSX', '__pycache__', '.git', '.svn',
]);
// 媒体扩展名（与后端 VIDEO_EXT + IMAGE_EXT 对应），用于识别"伪目录"（例如 Synology @eaDir 下为每张图片建立的同名 .jpg 结尾的缓存子目录）
const MEDIA_EXT_SET = new Set([
  '.mp4', '.webm', '.mov', '.mkv', '.m4v', '.avi', '.ogv',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif', '.avif', '.svg',
]);

/**
 * 判断是否垃圾目录（前端兜底，防止后端老版本还在输出 @eaDir 等）
 * 命中规则（任一命中即垃圾，与后端 is_trash_path 保持一致）：
 *   1) 任一段在 FOLDER_SKIP_SEGMENTS 中
 *   2) 任一段以 ._ 开头（macOS 经 SMB/WebDAV 写 NAS 时自动生成的 Apple Double 资源叉伪目录，如 ._DAV、._宋轶）
 *   3) 任一段以媒体扩展名结尾（@eaDir/xxx.jpg 伪目录）
 * @param {{parts:string[]}} p parseFolderDisplay 返回的对象
 */
function isTrashFolder(p) {
  if (!p || !p.parts) return true;
  for (const seg of p.parts) {
    if (FOLDER_SKIP_SEGMENTS.has(seg)) return true;
    // Apple Double 通配：._ 开头直接视为垃圾
    if (seg.startsWith('._')) return true;
    const dot = seg.lastIndexOf('.');
    if (dot >= 0) {
      const ext = seg.slice(dot).toLowerCase();
      if (MEDIA_EXT_SET.has(ext)) return true;
    }
  }
  return false;
}

/**
 * 文件夹排序：父子紧邻深度优先（按目录树层级自然紧邻）
 * 规则：逐段比较 parts，直到某一段不同或一方结束；同层段按 zh 字典序；前缀相同时短的在前（父在前，子在后）。
 *   例：/ → /剧情 → /剧情/日本 → /剧情/日本/横屏 → /剧情/日本/竖屏 → /剧情/欧美 → /UNPRO → /UNPRO/xxx
 * 这样不会被"另一父目录的子目录"打断视觉连续，也不会让中文目录被排到列表末尾。
 */
function compareFolderTree(aFolder, bFolder) {
  const a = parseFolderDisplay(aFolder);
  const b = parseFolderDisplay(bFolder);
  if (a.depth === 0) return b.depth === 0 ? 0 : -1;
  if (b.depth === 0) return 1;
  const minLen = Math.min(a.parts.length, b.parts.length);
  for (let i = 0; i < minLen; i++) {
    const cmp = a.parts[i].localeCompare(b.parts[i], 'zh');
    if (cmp !== 0) return cmp;
  }
  return a.parts.length - b.parts.length;
}

// 渲染左侧文件夹浏览面板的文件夹列表（点击文件夹 → 切换当前目录）
function renderLeftFolderList() {
  folderList.innerHTML = '';
  const frag = document.createDocumentFragment();
  // 根目录选项
  const rootItem = document.createElement('div');
  const isRootSelected = state.selectedFolder === '/' || state.selectedFolder === '__all__';
  rootItem.className = 'move-item' + (isRootSelected ? ' current' : '');
  rootItem.dataset.folder = '/';
  const rootCount = state.folders.reduce((s, f) => s + ((f.video_count || f.count || 0) + (f.image_count || 0)), 0);
  rootItem.innerHTML = `<span><span class="ic">${SVG.folder}</span> 根目录</span><span class="count">${rootCount}</span>`;
  frag.appendChild(rootItem);

  const sortedFolders = state.folders
    .filter((f) => {
      if (f.folder === '/') return false;
      const p = parseFolderDisplay(f.folder);
      return p.depth > 0 && !isTrashFolder(p);
    })
    .slice()
    .sort((a, b) => compareFolderTree(a.folder, b.folder));

  for (let i = 0; i < sortedFolders.length; i++) {
    const f = sortedFolders[i];
    const d = parseFolderDisplay(f.folder);
    const videoCount = f.video_count || f.count || 0;
    const imageCount = f.image_count || 0;

    const el = document.createElement('div');
    el.className = 'move-item' + (state.selectedFolder === f.folder || state.selectedFolder === d.normalized ? ' current' : '');
    el.style.paddingLeft = (14 + d.indentPx) + 'px';
    el.title = d.displayPath;
    el.dataset.folder = f.folder;
    el.innerHTML =
      `<span><span class="ic">${SVG.folder}</span>` +
      (d.prefix ? `<span style="opacity:0.55; margin-right:2px;">${escapeHtml(d.prefix)}</span>` : '') +
      ` ${escapeHtml(d.leafName)}</span>` +
      `<span class="count">${videoCount + imageCount}</span>`;
    frag.appendChild(el);
  }

  folderList.appendChild(frag);
  applyListItemHeights(folderList);
}

// 切换当前目录（重建队列 + 自动播放第一个）
function switchFolder(folder) {
  state.selectedFolder = folder;
  state.defaultFolder = state.defaultFolder || {};
  state.defaultFolder[state.mediaType] = folder;
  saveState();
  leftPanel.classList.add('hidden');
  rebuildAndPlay();
}

function renderMoveFolderList() {
  const cur = state.mediaType === 'image' ? state.imageSlots.current : state.slots.current;
  moveFolderList.innerHTML = '';
  const frag = document.createDocumentFragment();

  // 根目录选项（不可滑动删除）
  const rootItem = document.createElement('div');
  rootItem.className = 'move-item' + (cur && cur.folder === '/' ? ' current' : '');
  rootItem.dataset.folder = '/';
  rootItem.innerHTML = `<span><span class="ic">${SVG.folder}</span> 根目录</span><span class="count">/</span>`;
  frag.appendChild(rootItem);

  const sortedFolders = state.folders
    .filter((f) => {
      if (f.folder === '/') return false;
      const p = parseFolderDisplay(f.folder);
      return p.depth > 0 && !isTrashFolder(p);
    })
    .slice()
    .sort((a, b) => compareFolderTree(a.folder, b.folder));

  for (let i = 0; i < sortedFolders.length; i++) {
    const f = sortedFolders[i];
    const d = parseFolderDisplay(f.folder);
    const videoCount = f.video_count || f.count || 0;
    const imageCount = f.image_count || 0;

    const wrapper = document.createElement('div');
    wrapper.className = 'swipe-item';
    wrapper.dataset.folder = f.folder;

    const content = document.createElement('div');
    content.className = 'move-item swipe-content' + (cur && (cur.folder === f.folder || cur.folder === d.normalized) ? ' current' : '');
    // paddingLeft 实现缩进；title 放完整路径，鼠标悬停 tooltip 能看见全路径
    content.style.paddingLeft = (14 + d.indentPx) + 'px';
    content.title = d.displayPath;
    content.innerHTML =
      `<span><span class="ic">${SVG.folder}</span>` +
      (d.prefix ? `<span style="opacity:0.55; margin-right:2px;">${escapeHtml(d.prefix)}</span>` : '') +
      ` ${escapeHtml(d.leafName)}</span>` +
      `<span class="count">${videoCount + imageCount}</span>`;
    wrapper.appendChild(content);
    frag.appendChild(wrapper);
  }

  moveFolderList.appendChild(frag);
  applyListItemHeights(moveFolderList);
}

// 单个文件夹删除
async function deleteFolderSingle(folder) {
  if (!await showConfirm(`确定删除文件夹「${folder}」及其所有内容？此操作不可恢复。`)) return;
  try {
    const r = await fetch('/api/folders/' + encodeURIComponent(folder), { method: 'DELETE' });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || '删除失败');
    state.folders = data.folders;
    const prefix = folder + '/';
    state.allVideos = state.allVideos.filter((v) => v.folder !== folder && !v.folder.startsWith(prefix));
    state.allImages = state.allImages.filter((v) => v.folder !== folder && !v.folder.startsWith(prefix));
    updateFolderSelect(state.folders);
    updateDefaultFolderSelects(state.folders);
    renderMoveFolderList();
    rebuildAndPlay();
  } catch (e) {
    showAlert('删除失败: ' + e.message);
  }
}

// 文件夹重命名
async function renameFolder(folder) {
  const newName = await showPrompt('重命名文件夹', folder);
  if (!newName || newName === folder) return;
  try {
    const r = await fetch('/api/folders/' + encodeURIComponent(folder) + '/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_name: newName }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || '重命名失败');
    state.folders = data.folders;
    // 更新本地文件列表中的 folder 字段
    state.allVideos.forEach((v) => {
      if (v.folder === folder) v.folder = newName;
      else if (v.folder.startsWith(folder + '/')) v.folder = newName + v.folder.slice(folder.length);
    });
    state.allImages.forEach((v) => {
      if (v.folder === folder) v.folder = newName;
      else if (v.folder.startsWith(folder + '/')) v.folder = newName + v.folder.slice(folder.length);
    });
    updateFolderSelect(state.folders);
    updateDefaultFolderSelects(state.folders);
    renderMoveFolderList();
    rebuildAndPlay();
  } catch (e) {
    showAlert('重命名失败: ' + e.message);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ==================== 重命名文件 ====================
async function renameCurrentFile() {
  const isImage = state.mediaType === 'image';
  const cur = isImage ? state.imageSlots.current : state.slots.current;
  if (!cur) return;
  const oldName = cur.name;
  // 去掉扩展名作为默认值
  const dotIdx = oldName.lastIndexOf('.');
  const defaultVal = dotIdx > 0 ? oldName.substring(0, dotIdx) : oldName;
  const newName = await showPrompt('重命名文件', defaultVal);
  if (!newName) return;
  const apiBase = isImage ? '/api/images/' : '/api/videos/';
  try {
    const r = await fetch(apiBase + cur.id + '/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_name: newName }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || '重命名失败');
    // 更新本地数据
    const arr = isImage ? state.allImages : state.allVideos;
    const item = arr.find((v) => v.id === cur.id);
    if (item) {
      item.id = data.new_id;
      item.name = data.new_name;
    }
    // 更新 slots
    if (isImage) {
      Object.keys(state.imageSlots).forEach((k) => {
        if (state.imageSlots[k] && state.imageSlots[k].id === cur.id) {
          state.imageSlots[k].id = data.new_id;
          state.imageSlots[k].name = data.new_name;
        }
      });
    } else {
      Object.keys(state.slots).forEach((k) => {
        if (state.slots[k] && state.slots[k].id === cur.id) {
          state.slots[k].id = data.new_id;
          state.slots[k].name = data.new_name;
        }
      });
    }
    updateFolderSelect(data.folders);
    state.folders = data.folders;
    updateInfo();
    // 如果是视频，重新加载 src
    if (!isImage) {
      loadSlot('current', state.slots.current);
      playCurrent();
    }
  } catch (e) {
    showAlert('重命名失败: ' + e.message);
  }
}

// 长按底部文件名 → 重命名文件
function attachLongPress(el, callback) {
  let timer = null;
  const start = (e) => {
    // 排除多指触摸
    if (e.touches && e.touches.length !== 1) return;
    const x = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0].clientX);
    const y = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0].clientY);
    timer = setTimeout(() => {
      timer = null;
      callback();
    }, 500);
  };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchend', cancel, { passive: true });
  el.addEventListener('touchmove', cancel, { passive: true });
  el.addEventListener('touchcancel', cancel, { passive: true });
  el.addEventListener('mousedown', start);
  el.addEventListener('mouseup', cancel);
  el.addEventListener('mouseleave', cancel);
  el.addEventListener('mousemove', cancel);
}

// 长按底部文件名 → 重命名文件
attachLongPress(infoEl, renameCurrentFile);

// 长按顶部文件夹名 → 重命名文件夹
attachLongPress(indicator, () => {
  const cur = state.mediaType === 'image' ? state.imageSlots.current : state.slots.current;
  if (!cur || cur.folder === '/' || cur.folder === '__all__') return;
  renameFolder(cur.folder);
});

async function deleteCurrentVideo() {
  const cur = state.slots.current;
  if (!cur) return;
  try {
    const r = await fetch('/api/videos/' + cur.id, { method: 'DELETE' });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || '删除失败');
    // 从 allVideos 移除
    state.allVideos = state.allVideos.filter((v) => v.id !== cur.id);
    // 更新文件夹下拉
    updateFolderSelect(data.folders);
    state.folders = data.folders;
    deleteModal.classList.add('hidden');
    // 重建队列并播放下一个
    rebuildAndPlay();
  } catch (e) {
    showAlert('删除失败: ' + e.message);
  }
}

function deleteCurrentItem() {
  if (state.mediaType === 'image') deleteCurrentImage();
  else deleteCurrentVideo();
}

async function deleteCurrentImage() {
  const cur = state.imageSlots.current;
  if (!cur) return;
  try {
    const r = await fetch('/api/images/' + cur.id, { method: 'DELETE' });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || '删除失败');
    state.allImages = state.allImages.filter((v) => v.id !== cur.id);
    updateFolderSelect(data.folders);
    state.folders = data.folders;
    deleteModal.classList.add('hidden');
    rebuildAndPlay();
  } catch (e) {
    showAlert('删除失败: ' + e.message);
  }
}

async function moveCurrentTo(destFolder) {
  const isImage = state.mediaType === 'image';
  const cur = isImage ? state.imageSlots.current : state.slots.current;
  if (!cur) return;
  if (cur.folder === destFolder) {
    movePanel.classList.add('hidden');
    return;
  }
  try {
    const apiBase = isImage ? '/api/images/' : '/api/videos/';
    const r = await fetch(apiBase + cur.id + '/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: destFolder }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || '移动失败');
    // 更新本地数据：移动后文件路径变化 → id 也变化，需用后端返回的新 id 同步
    const arr = isImage ? state.allImages : state.allVideos;
    const item = arr.find((v) => v.id === cur.id);
    if (item) {
      item.id = data.new_id;
      item.folder = data.new_folder || destFolder;
      if (data.new_name) item.name = data.new_name;
    }
    // 同步 slots 中可能存在的引用（prev/next 预加载）
    const slots = isImage ? state.imageSlots : state.slots;
    ['prev', 'current', 'next'].forEach((k) => {
      if (slots[k] && slots[k].id === cur.id) {
        slots[k].id = data.new_id;
        slots[k].folder = data.new_folder || destFolder;
        if (data.new_name) slots[k].name = data.new_name;
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
  optAll.textContent = `全部 (视频${state.allVideos.length}/图片${state.allImages.length})`;
  folderSelect.appendChild(optAll);
  // 归一化排序（父目录必须在子目录前面），option 文本加缩进 + 前导符，
  // 这样原生 select 下拉也能一眼看出层次（之前显示的是完整路径，嵌套多层后很长，像"只有一层"）。
  const sortedFolders = folders
    .slice()
    .filter((f) => {
      if (f.folder === '/') return false;
      const p = parseFolderDisplay(f.folder);
      return p.depth > 0 && !isTrashFolder(p);
    })
    .sort((a, b) => compareFolderTree(a.folder, b.folder));
  sortedFolders.forEach((f) => {
    const o = document.createElement('option');
    o.value = f.folder;
    const vc = f.video_count != null ? f.video_count : (f.count || 0);
    const ic = f.image_count != null ? f.image_count : 0;
    const d = parseFolderDisplay(f.folder);
    const indentStr = d.depth > 0 ? '\u00A0\u00A0'.repeat(Math.max(0, d.depth - 1)) : '';
    const prefixStr = d.depth > 1 ? '\u2514 ' : '';
    o.textContent = `${indentStr}${prefixStr}${d.leafName || f.folder} (视频${vc}/图片${ic})`;
    o.title = d.displayPath;
    folderSelect.appendChild(o);
  });
  folderSelect.value = state.selectedFolder;
}

// 打开树状文件夹浏览面板（设置页"📁 浏览"按钮触发，之前 showLeftPanel 没有入口，用户想切目录只能用下拉）
document.getElementById('btnOpenFolderTree').addEventListener('click', () => {
  settingsPanel.classList.add('hidden'); // 先关设置页（树状面板是全屏的），避免 z-index 堆叠
  showLeftPanel();
});

// 1) 右侧侧边栏「删除」按钮：先弹确认框，不再直接删（防止误操作）
btnDelete.addEventListener('click', () => showDeleteModal());
// 2) 删除确认弹窗里的「删除」按钮：真正执行删除
btnConfirmDelete.addEventListener('click', deleteCurrentItem);
// 3) 删除确认弹窗的「取消」：关弹窗
document.getElementById('btnLeftCancel').addEventListener('click', () => deleteModal.classList.add('hidden'));
// 4) 左侧文件夹面板的关闭按钮：关面板
btnLeftClose.addEventListener('click', () => leftPanel.classList.add('hidden'));
// 5) 移动面板的关闭按钮：关面板
btnMoveClose.addEventListener('click', () => movePanel.classList.add('hidden'));
btnNewFolder.addEventListener('click', createFolder);
newFolderInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createFolder();
});

// 点击遮罩背景关闭面板（点击卡片内不关闭）
leftPanel.addEventListener('click', (e) => {
  if (e.target === leftPanel) leftPanel.classList.add('hidden');
});
deleteModal.addEventListener('click', (e) => {
  if (e.target === deleteModal) deleteModal.classList.add('hidden');
});
movePanel.addEventListener('click', (e) => {
  if (e.target === movePanel) movePanel.classList.add('hidden');
});
// 设置面板改为全屏页面，不再监听 backdrop 点击关闭

// ==================== 设置 ====================
function toggleMute() {
  state.muted = !state.muted;
  localStorage.setItem('muted', state.muted ? '1' : '0');
  Object.values(videos).forEach((v) => v.muted = state.muted);
  btnMute.querySelector('.icon').innerHTML = state.muted ? SVG.speakerMuted : SVG.speaker;
  btnMute.querySelector('.label').textContent = state.muted ? '取消静音' : '静音';
}

btnMute.addEventListener('click', toggleMute);

// 设置页底部功能栏：点击视频/照片退出设置并切到对应模式
btnSettingsVideo.addEventListener('click', () => {
  const target = 'video';
  if (state.mediaType !== target) {
    // 模式不同：先切模式（会 rebuildAndPlay），再关闭设置
    switchMode(target);
  }
  closeSettings();
});
btnSettingsImage.addEventListener('click', () => {
  const target = 'image';
  if (state.mediaType !== target) {
    switchMode(target);
  }
  closeSettings();
});
// 设置按钮本身保持当前页，不做跳转

btnRefresh.addEventListener('click', async () => {
  btnRefresh.textContent = '刷新中…';
  btnRefresh.disabled = true;
  await init();
  btnRefresh.textContent = '刷新目录';
  btnRefresh.disabled = false;
  closeSettings();
});

// ===== 密码管理 =====
const authStatusText = document.getElementById('auth-status-text');
const authPasswordInput = document.getElementById('auth-password-input');

async function loadAuthStatus() {
  try {
    const r = await fetch('/api/auth-status');
    const data = await r.json();
    if (!data.required) {
      authStatusText.textContent = '当前：未设置密码（任何人可访问）';
      authStatusText.style.color = 'rgba(255,255,255,0.4)';
    } else {
      authStatusText.textContent = '当前：已启用密码保护';
      authStatusText.style.color = '#34c759';
    }
  } catch (e) {
    authStatusText.textContent = '状态加载失败';
  }
}

document.getElementById('btnSavePassword').addEventListener('click', async () => {
  const pw = authPasswordInput.value;
  try {
    const r = await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    const data = await r.json();
    if (data.ok) {
      authPasswordInput.value = '';
      await loadAuthStatus();
      // 密码改变后 token 失效，需重新登录（除非清除了密码）
      if (pw) {
        setTimeout(() => location.reload(), 600);
      }
    } else {
      alert(data.error || '保存失败');
    }
  } catch (e) {
    alert('网络错误');
  }
});

document.getElementById('btnClearPassword').addEventListener('click', async () => {
  if (!confirm('确定清除密码？清除后任何人可直接访问')) return;
  try {
    const r = await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: '' }),
    });
    const data = await r.json();
    if (data.ok) {
      authPasswordInput.value = '';
      await loadAuthStatus();
    } else {
      alert(data.error || '清除失败');
    }
  } catch (e) {
    alert('网络错误');
  }
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

// 图片自动切换间隔（滑动选择器）
const optImageInterval = document.getElementById('opt-image-interval');
const imageIntervalLabel = document.getElementById('image-interval-label');
function updateIntervalLabel() {
  imageIntervalLabel.textContent = state.imageAutoInterval === 0 ? '关闭' : state.imageAutoInterval + 's';
}
optImageInterval.value = state.imageAutoInterval;
optImageInterval.max = 30;
updateIntervalLabel();
optImageInterval.addEventListener('input', () => {
  state.imageAutoInterval = parseInt(optImageInterval.value, 10) || 0;
  updateIntervalLabel();
  localStorage.setItem('imageAutoInterval', String(state.imageAutoInterval));
  if (state.mediaType === 'image') resetImageAutoTimer();
});

// 操作说明弹窗
btnHelp.addEventListener('click', () => {
  const helpHtml =
    '<div style="text-align:left;line-height:1.8;font-size:14px;">' +
    '<div style="color:#0a84ff;font-weight:600;margin:8px 0 4px;">通用手势</div>' +
    '<div>上下滑动 — 切换上一个/下一个</div>' +
    '<div>左滑 — 移动到文件夹</div>' +
    '<div>右滑 — 删除（带确认）</div>' +
    '<div>双指外滑 — 隐藏所有按钮</div>' +
    '<div>双指内滑 — 恢复显示按钮</div>' +
    '<div style="color:#0a84ff;font-weight:600;margin:12px 0 4px;">视频模式</div>' +
    '<div>单击 — 暂停/播放</div>' +
    '<div>双击 — 恢复1倍速</div>' +
    '<div>长按+左右滑 — 调节进度</div>' +
    '<div>长按+上下滑 — 调节播放速度</div>' +
    '<div style="color:#0a84ff;font-weight:600;margin:12px 0 4px;">图片模式</div>' +
    '<div>单击 — 隐藏/显示UI</div>' +
    '<div>设置中可开启自动切换</div>' +
    '<div style="color:#0a84ff;font-weight:600;margin:12px 0 4px;">重命名</div>' +
    '<div>长按底部文件名 — 重命名文件</div>' +
    '<div>长按顶部文件夹名 — 重命名文件夹</div>' +
    '</div>';
  // 用 modal 弹窗展示 HTML 内容
  modalMsg.innerHTML = helpHtml;
  modalCancel.style.display = '';
  modalInput.classList.add('hidden');
  modalOk.textContent = '知道了';
  modal.classList.remove('hidden');
  const onOk = () => { cleanup(); };
  const onCancel = () => { cleanup(); };
  const onBackdrop = (e) => { if (e.target === modal) onCancel(); };
  const cleanup = () => {
    modal.classList.add('hidden');
    modalOk.removeEventListener('click', onOk);
    modalCancel.removeEventListener('click', onCancel);
    modal.removeEventListener('click', onBackdrop);
    modalOk.textContent = '确定';
  };
  modalOk.addEventListener('click', onOk);
  modalCancel.addEventListener('click', onCancel);
  modal.addEventListener('click', onBackdrop);
});

// ==================== 默认文件夹设置 ====================
function updateDefaultFolderSelects(folders) {
  // 归一化排序的公共过滤 + 排序逻辑，保证父在前子在后 + 层次缩进
  const sortedFolders = folders
    .slice()
    .filter((f) => {
      if (f.folder === '/') return false;
      const p = parseFolderDisplay(f.folder);
      return p.depth > 0 && !isTrashFolder(p);
    })
    .sort((a, b) => compareFolderTree(a.folder, b.folder));
  const buildOption = (f) => {
    const o = document.createElement('option');
    o.value = f.folder;
    const d = parseFolderDisplay(f.folder);
    const indentStr = d.depth > 0 ? '\u00A0\u00A0'.repeat(Math.max(0, d.depth - 1)) : '';
    const prefixStr = d.depth > 1 ? '\u2514 ' : '';
    o.textContent = `${indentStr}${prefixStr}${d.leafName || f.folder}`;
    o.title = d.displayPath;
    return o;
  };

  // 视频默认文件夹
  defaultVideoFolderSelect.innerHTML = '';
  const optAllV = document.createElement('option');
  optAllV.value = '__all__';
  optAllV.textContent = '全部';
  defaultVideoFolderSelect.appendChild(optAllV);
  sortedFolders.forEach((f) => defaultVideoFolderSelect.appendChild(buildOption(f)));
  defaultVideoFolderSelect.value = state.defaultVideoFolder;

  // 图片默认文件夹
  defaultImageFolderSelect.innerHTML = '';
  const optAllI = document.createElement('option');
  optAllI.value = '__all__';
  optAllI.textContent = '全部';
  defaultImageFolderSelect.appendChild(optAllI);
  sortedFolders.forEach((f) => defaultImageFolderSelect.appendChild(buildOption(f)));
  defaultImageFolderSelect.value = state.defaultImageFolder;
}

defaultVideoFolderSelect.addEventListener('change', () => {
  state.defaultVideoFolder = defaultVideoFolderSelect.value;
  localStorage.setItem('defaultVideoFolder', state.defaultVideoFolder);
});

defaultImageFolderSelect.addEventListener('change', () => {
  state.defaultImageFolder = defaultImageFolderSelect.value;
  localStorage.setItem('defaultImageFolder', state.defaultImageFolder);
});

function rebuildAndPlay() {
  if (state.mediaType === 'image') {
    buildImageQueue();
    if (state.imageQueue.length > 0) {
      fillImageSlots(state.imageQueue[0]);
      showCurrentImage();
      resetImageAutoTimer();
    } else {
      fillImageSlots(null);
      updateInfo();
      stopImageAutoTimer();
    }
  } else {
    buildQueue();
    if (state.queue.length > 0) {
      fillSlots(state.queue[0]);
      playCurrent();
    } else {
      fillSlots(null);
      updateInfo();
    }
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

function bindProgressEvents(v, slotName) {
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
    // 记录视频方向，用于全屏时锁定正确的屏幕方向
    if (slotName === 'current') {
      state.videoLandscape = v.videoWidth > v.videoHeight;
    }
    // 元数据加载成功，清除错误检测计时器
    if (v._errorTimer) { clearTimeout(v._errorTimer); v._errorTimer = null; }

    // ===== 关键：声音正常 / 画面黑屏（视频浏览器无法解码）检测 =====
    // 当 mp4 内视频编码是 H.265/HEVC、H.264 High 10（10-bit）、H.264 4:2:2/4:4:4、
    // VP9 Profile1/3、AV1（部分老 Safari）时，浏览器的 <video> 元素能读取容器元数据
    // （duration > 0、音轨正常、AudioTracks.length>0、甚至能播声音），
    // 但唯独 **videoWidth === 0 且 videoHeight === 0** — 因为它根本没把视频帧解出来。
    // 这就是用户说的"声音正常，画面一直黑屏" — 精确命中这个场景 → 直接自动转码。
    const hasDuration = typeof v.duration === 'number' && isFinite(v.duration) && v.duration > 0;
    const zeroVideoFrame = (v.videoWidth || 0) === 0 && (v.videoHeight || 0) === 0;
    if (slotName === 'current' && hasDuration && zeroVideoFrame) {
      console.warn('[video-zero-size] loadedmetadata: duration=', v.duration,
        'videoWidth=', v.videoWidth, 'videoHeight=', v.videoHeight,
        'audioTracks=', v.audioTracks ? v.audioTracks.length : 'N/A',
        '→ 声音正常但浏览器无法解视频画面 → 触发自动转码');
      try { v.pause(); } catch(_) {}
      // 等 500ms 再查一次，部分浏览器在 loadedmetadata 后一小段时间
      // 才把 videoWidth/videoHeight 填上（延迟解码的 case）。
      // 如果 500ms 后仍然 0×0 → 直接触发 startAutoConvert，不再让用户手动点。
      if (v._zeroFrameTimer) clearTimeout(v._zeroFrameTimer);
      const loadedId = v._loadedId;
      v._zeroFrameTimer = setTimeout(() => {
        const w = v.videoWidth || 0, h = v.videoHeight || 0;
        // 二次校验：500ms 后如果视频已经不是当前 slot 了（用户滑走了）就不处理
        if (videos.current._loadedId !== loadedId) return;
        if (w === 0 && h === 0) {
          const meta = state.slots.current;
          if (meta) startAutoConvert(meta, 'video-zero-size');
        }
      }, 500);
    }
    // 【带宽串行化】current 元数据已拿到（HTTP 握手完成、流已建立），
    // 这时才去调度 prev/next 的 slot 填充，完全不跟 current 抢带宽。
    // 即使 1 秒内用户又滑动取消了，fillSlots 里也会先 clear 掉老的 pending。
    if (slotName === 'current') {
      scheduleFillAdjacent(v._loadedId);
    }
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
let progressDragWasPlaying = false;

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
  const newTime = pct * v.duration;
  // 进度条+时间文字每次 pointermove 都更新，60fps 跟手
  progressPlayed.style.width = (pct * 100) + '%';
  progressThumb.style.left = (pct * 100) + '%';
  timeCurrent.textContent = formatTime(newTime);
  // 与全屏长按 seek 统一接口：
  // - 手机端：写目标时间，rAF 循环 60fps 画 + 每66ms真正seek
  // - PC 端：暂停态 currentTime 变化直接合成帧，所以无节流直接 seek
  if (IS_TOUCH) {
    setTargetSeekTime(newTime);
  } else {
    if (Math.abs(newTime - v.currentTime) > 0.008) {
      v.currentTime = newTime;
    }
  }
}

progressBar.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const v = videos.current;
  progressDragging = true;
  progressDragWasPlaying = v ? !v.paused : false;
  if (v && !v.paused) v.pause();
  startSeekPreview(v);  // 手机端：开启 canvas + rAF 循环
  progressBar.classList.add('dragging');
  progressBar.setPointerCapture(e.pointerId);
  seekToPct(getProgressPct(e.clientX));
});

progressBar.addEventListener('pointermove', (e) => {
  if (!progressDragging) return;
  seekToPct(getProgressPct(e.clientX));
});

progressBar.addEventListener('pointerup', (e) => {
  if (!progressDragging) return;
  progressDragging = false;
  progressBar.classList.remove('dragging');
  try { progressBar.releasePointerCapture(e.pointerId); } catch(_) {}
  const v = videos.current;
  // 松手：强制停在最终位置，保证最后一次 pointermove（哪怕被节流）都落位
  if (v && v.duration) {
    const finalTime = getProgressPct(e.clientX) * v.duration;
    try { v.currentTime = finalTime; } catch(_) {}
  }
  stopSeekPreview(); // 停 rAF 循环 + 隐藏 canvas
  if (v && progressDragWasPlaying) v.play().catch(() => {});
  progressDragWasPlaying = false;
});

progressBar.addEventListener('pointercancel', () => {
  if (!progressDragging) return;
  progressDragging = false;
  progressBar.classList.remove('dragging');
  stopSeekPreview();
  const v = videos.current;
  if (v && progressDragWasPlaying) v.play().catch(() => {});
  progressDragWasPlaying = false;
});

// ==================== 全屏 ====================
function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement ||
            document.webkitCurrentFullScreenElement);
}

function enterFullscreen() {
  // 对 document.documentElement 全屏，而非 #app
  // 这样 #app 外的 #settings-panel、#left-panel、#modal 不被 stacking context 遮挡
  const el = document.documentElement;
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

async function lockOrientationByVideo() {
  // 根据当前视频的宽高比锁定屏幕方向
  // 注意：参数已对调 —— 横屏视频 → 竖屏方向锁定；竖屏视频 → 横屏方向锁定
  // 因为 screen.orientation.lock 在移动端的实际效果与字面含义在某些场景下相反
  const v = videos.current;
  let landscape = state.videoLandscape;
  if (v && v.videoWidth && v.videoHeight) {
    landscape = v.videoWidth > v.videoHeight;
  }
  if (screen.orientation && screen.orientation.lock) {
    try { await screen.orientation.lock(landscape ? 'portrait' : 'landscape'); }
    catch (_) {}
  }
}

async function toggleFullscreen() {
  try {
    if (!isFullscreen()) {
      await enterFullscreen();
      // 进入全屏后，根据当前视频方向锁定屏幕
      // 横屏视频 → 横屏全屏；竖屏视频 → 竖屏全屏
      await lockOrientationByVideo();
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
  btnFullscreen.querySelector('.icon').innerHTML = fs ? SVG.fullscreenExit : SVG.fullscreen;
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

  // ===== 文件夹列表：滑动/点击事件委托（只绑一次，监听器 O(1) 不随条目数增长）=====
  // 左侧文件夹面板：点击 → 切换目录；不支持滑动删除
  bindSwipeDelegation(folderList, { clickFolder: (folder) => switchFolder(folder) });
  // 移动到文件夹面板：点击 → 移动当前视频到此目录；左滑超过 40px → 触发删除文件夹确认
  bindSwipeDelegation(moveFolderList, {
    clickFolder: (folder) => moveCurrentTo(folder),
    deleteFolder: async (folder) => deleteFolderSingle(folder),
  });

  // 初始化图标
  btnMute.querySelector('.icon').innerHTML = state.muted ? SVG.speakerMuted : SVG.speaker;
  btnMute.querySelector('.label').textContent = state.muted ? '取消静音' : '静音';
  btnFullscreen.querySelector('.icon').innerHTML = SVG.fullscreen;
  playBadge.innerHTML = SVG.play;
  errorBadge.querySelector('.err-icon').innerHTML = SVG.alert;
  const delIc = btnDelete.querySelector('.btn-ic');
  if (delIc) delIc.innerHTML = SVG.trash;
  // 功能栏图标
  document.querySelector('#btnFuncVideo .func-ic').innerHTML = SVG.video;
  document.querySelector('#btnFuncImage .func-ic').innerHTML = SVG.image;
  document.querySelector('#btnFuncSettings .func-ic').innerHTML = SVG.settings;
  // 设置页底部功能栏图标
  document.querySelector('#btnSettingsVideo .func-ic').innerHTML = SVG.video;
  document.querySelector('#btnSettingsImage .func-ic').innerHTML = SVG.image;
  document.querySelector('#btnSettingsSettings .func-ic').innerHTML = SVG.settings;
  updateFullscreenBtn();

  // 根据当前 mediaType 初始化：只设置主页面 #funcbar 按钮高亮
  if (state.mediaType === 'image') {
    document.body.classList.add('image-mode');
    feedImage.classList.remove('hidden');
    state.selectedFolder = state.defaultImageFolder;
    folderSelect.value = state.selectedFolder;
    funcButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === 'image');
    });
  } else {
    funcButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === 'video');
    });
  }
  // 注意：设置页 #funcbar-settings 的按钮高亮完全由页面自身语义决定：
  // 在设置页时只高亮"设置"按钮（HTML写死 active），视频/照片按钮不高亮。
  // 这里不需要同步 settingsFuncButtons。

  // 检查是否有内容
  const hasContent = state.mediaType === 'image' ? state.allImages.length > 0 : state.allVideos.length > 0;
  if (!hasContent) {
    // 当前模式无内容，尝试切换到另一种模式
    if (state.mediaType === 'video' && state.allImages.length > 0) {
      switchMode('image');
      return;
    }
    if (state.mediaType === 'image' && state.allVideos.length > 0) {
      switchMode('video');
      return;
    }
    // 两种模式都无内容
    indicator.textContent = state.mediaType === 'image' ? '没有图片' : '没有视频';
    infoEl.textContent = '请把视频/图片放入 ./videos 目录（可建子文件夹），然后点右上角刷新';
    return;
  }

  rebuildAndPlay();
}

// ============================================================================
// 🔁 转码模块（手动按钮 — 仅 AUTO_CONVERT_ENABLED=true 时绑定事件，默认不绑定）
// ============================================================================
if (AUTO_CONVERT_ENABLED) {
  btnConvert.addEventListener('click', async () => {
    const cur = state.slots.current;
    if (!cur) return;
    btnConvert.classList.add('hidden');
    convertStatus.classList.remove('hidden');
    convertStatus.textContent = '转码中，请稍候…';
    const errTextEl = errorBadge.querySelector('.err-text');
    const errHintEl = errorBadge.querySelector('.err-hint');
    if (errTextEl) errTextEl.textContent = `正在转码：${cur.name}`;
    if (errHintEl) errHintEl.textContent = '大文件转码需要几十秒到几分钟，请耐心等待；转码完成后会自动播放';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12 * 60 * 1000);
      const r = await fetch('/api/convert/' + cur.id, { method: 'POST', signal: controller.signal });
      clearTimeout(timeout);
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || '转码失败');
      const v = state.allVideos.find((v) => v.id === data.old_id);
      if (v) {
        v.id = data.new_id;
        if (data.new_name) v.name = data.new_name;
      }
      state.folders = data.folders;
      updateFolderSelect(data.folders);
      convertStatus.textContent = '转码完成，正在加载…';
      if (errTextEl) errTextEl.textContent = '转码成功';
      if (errHintEl) errHintEl.textContent = `已生成 ${data.new_name || '新的 MP4 文件'}，自动切换播放`;
      setTimeout(() => {
        convertStatus.classList.add('hidden');
        rebuildAndPlay();
      }, 500);
    } catch (e) {
      const msg = (e && e.name === 'AbortError') ? '转码超时（已超过 12 分钟）' : (e.message || '未知错误');
      convertStatus.textContent = '转码失败: ' + msg;
      if (errTextEl) errTextEl.textContent = '转码失败';
      if (errHintEl) errHintEl.textContent = msg + '；请刷新重试或检查 ffmpeg 安装是否正常';
      btnConvert.classList.remove('hidden');
    }
  });
}
// ============================================================================
// 🔁 转码模块（手动按钮）结束
// ============================================================================

init();
