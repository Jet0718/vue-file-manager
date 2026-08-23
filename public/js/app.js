/* 本機檔案管理系統 — Vue 3 前端（Options API + Global Build，無建置步驟） */
const { createApp } = Vue;

/* ================= 檔案類型圖示 ================= */

const ICON_PATH = {
  folder:  '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  file:    '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
  image:   '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  video:   '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  audio:   '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  archive: '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>',
  code:    '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  text:    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  sheet:   '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>',
  exe:     '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
};

const TYPE_ICONS = {
  image:   { color: '#16a34a', path: ICON_PATH.image },
  video:   { color: '#7c3aed', path: ICON_PATH.video },
  audio:   { color: '#db2777', path: ICON_PATH.audio },
  pdf:     { color: '#dc2626', path: ICON_PATH.text },
  doc:     { color: '#2563eb', path: ICON_PATH.text },
  sheet:   { color: '#059669', path: ICON_PATH.sheet },
  slide:   { color: '#ea580c', path: ICON_PATH.text },
  archive: { color: '#d97706', path: ICON_PATH.archive },
  code:    { color: '#0891b2', path: ICON_PATH.code },
  text:    { color: '#64748b', path: ICON_PATH.text },
  exe:     { color: '#475569', path: ICON_PATH.exe },
  generic: { color: '#94a3b8', path: ICON_PATH.file },
};

const EXT_MAP = {
  // 圖片
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  bmp: 'image', ico: 'image', avif: 'image', heic: 'image', tif: 'image', tiff: 'image',
  // 影片
  mp4: 'video', mkv: 'video', avi: 'video', mov: 'video', webm: 'video', flv: 'video',
  wmv: 'video', m4v: 'video', mpg: 'video', mpeg: 'video', '3gp': 'video', ts: 'video',
  // 音樂
  mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', aac: 'audio', m4a: 'audio',
  wma: 'audio', opus: 'audio', mid: 'audio', midi: 'audio',
  // 文件
  pdf: 'pdf', doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', ods: 'sheet', numbers: 'sheet',
  ppt: 'slide', pptx: 'slide', key: 'slide', odp: 'slide',
  txt: 'text', md: 'text', log: 'text', ini: 'text', cfg: 'text',
  // 壓縮檔
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  bz2: 'archive', xz: 'archive', zst: 'archive', iso: 'archive', dmg: 'archive',
  // 程式碼
  js: 'code', ts: 'code', jsx: 'code', tsx: 'code', py: 'code', rb: 'code', go: 'code',
  rs: 'code', java: 'code', c: 'code', h: 'code', cpp: 'code', hpp: 'code', cs: 'code',
  php: 'code', html: 'code', css: 'code', scss: 'code', json: 'code', xml: 'code',
  yaml: 'code', yml: 'code', vue: 'code', sh: 'code', bat: 'code', ps1: 'code',
  sql: 'code', kt: 'code', swift: 'code',
  // 執行檔／安裝檔
  exe: 'exe', msi: 'exe', app: 'exe', deb: 'exe', rpm: 'exe', bin: 'exe',
  pkg: 'exe', apk: 'exe', ipa: 'exe', run: 'exe',
};

function wrapIcon(path, color, size) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

/* ================= 根元件 ================= */

const App = {
  data() {
    return {
      roots: [],
      meta: { platform: '', isWSL: false, home: '' },
      sidebarTab: 'dirs',        // dirs | favs | recent
      sidebarW: (() => { try { return Number(localStorage.getItem('fm-sidebar-w')) || 300; } catch { return 300; } })(),
      resizing: false,
      favorites: [],             // [{ path, name }]
      favSet: {},                // path -> true
      recentDays: (() => { try { return Number(localStorage.getItem('fm-recent-days')) || 14; } catch { return 14; } })(),
      recentItems: [],
      recentLoading: false,
      recentError: '',
      searchQuery: '',
      searchScopeFolder: false,
      searchState: { show: false, query: '', engine: '', info: '', items: [], loading: false, error: '' },
      selectedDirPath: '',      // 樹上目前反白的資料夾
      selectedDir: null,        // { path, name }
      files: [],
      loadingFiles: false,
      selectedSet: {},             // path -> true（複選）
      showHidden: false,
      search: '',
      sortKey: 'mtime',         // mtime | name | size
      pinDirs: true,            // 資料夾置頂
      activeFile: null,         // 檔案列反白
      expanded: {},             // path -> bool
      dirCache: {},             // path -> [dirs]
      treeLoading: {},          // path -> bool
      treeErrors: {},           // path -> bool
      destModal: { show: false, mode: 'copy', src: null, srcs: null, srcName: '', dest: '', destOk: false, destInfo: false },
      renameModal: { show: false, path: '', oldName: '', newName: '', error: '' },
      preview: { show: false, name: '', path: '', kind: '', content: '', rendered: '', info: '', loading: false, error: '' },
      toast: { show: false, msg: '', type: 'ok' },
    };
  },

  computed: {
    self() { return this; }, // 供 tree-node 遞迴取用根實例

    visibleFiles() {
      let list = this.files;
      if (this.dirFilter) {
        const s = this.dirFilter.toLowerCase();
        list = list.filter((f) => f.name.toLowerCase().includes(s));
      }
      const key = this.sortKey;
      list = list.slice().sort((a, b) => {
        if (key === 'mtime') return b.mtime - a.mtime;          // 修改日期：新 → 舊
        if (key === 'size') return b.size - a.size;
        return a.name.localeCompare(b.name, 'zh-Hant', { numeric: true });
      });
      if (this.pinDirs) {
        return list.filter((f) => f.isDir).concat(list.filter((f) => !f.isDir));
      }
      return list;
    },

    totalSize() {
      return this.files.reduce((s, f) => s + (f.isDir ? 0 : f.size), 0);
    },

    /* ---- 複選狀態 ---- */
    selectionCount() {
      return Object.keys(this.selectedSet).length;
    },

    selectedPaths() {
      return Object.keys(this.selectedSet);
    },

    allSelected() {
      return this.visibleFiles.length > 0 && this.visibleFiles.every((f) => !!this.selectedSet[f.path]);
    },

    breadcrumbs() {
      const p = this.selectedDir ? this.selectedDir.path : '';
      if (!p) return [];
      const sep = p.includes('\\') ? '\\' : '/';
      const parts = p.split(sep).filter(Boolean);
      const crumbs = [];
      if (p.startsWith(sep)) crumbs.push({ name: sep, path: sep });
      let acc = p.startsWith(sep) ? sep : '';
      for (const part of parts) {
        acc = acc ? acc + sep + part : part;
        crumbs.push({ name: part, path: acc });
      }
      return crumbs;
    },
  },

  watch: {
    showHidden() { this.refresh(); },
    'destModal.dest'() { this.validateDest(); },
  },

  methods: {
    /* ---- 基礎工具 ---- */
    async api(url, opts) {
      const res = await fetch(url, opts);
      let data = {};
      try { data = await res.json(); } catch (e) { /* 非 JSON 回應 */ }
      if (!res.ok) throw new Error(data.error || `請求失敗（${res.status}）`);
      return data;
    },

    showToast(msg, type = 'ok') {
      this.toast.msg = msg;
      this.toast.type = type;
      this.toast.show = true;
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => { this.toast.show = false; }, 3500);
    },

    splitPath(p) {
      const sep = p.includes('\\') ? '\\' : '/';
      return p.split(sep).filter(Boolean);
    },

    /* ---- 樹狀目錄 ---- */
    async loadRoots(autoSelect = true) {
      try {
        const d = await this.api('/api/roots');
        this.roots = d.roots;
        if (autoSelect && this.roots.length && !this.selectedDir) {
          await this.selectDir(this.roots[0]);
        }
      } catch (e) {
        this.showToast('載入常用目錄失敗：' + e.message, 'err');
      }
    },

    async loadChildren(node) {
      const p = node.path;
      if (this.dirCache[p]) return this.dirCache[p];
      this.treeLoading[p] = true;
      delete this.treeErrors[p];
      try {
        const d = await this.api(`/api/dirs?path=${encodeURIComponent(p)}&hidden=${this.showHidden ? 1 : 0}`);
        this.dirCache[p] = d.dirs;
      } catch (e) {
        this.treeErrors[p] = true;
        this.dirCache[p] = [];
        this.showToast('讀取資料夾失敗：' + e.message, 'err');
      } finally {
        delete this.treeLoading[p];
      }
      return this.dirCache[p];
    },

    async toggleExpand(node) {
      if (this.expanded[node.path]) { this.expanded[node.path] = false; return; }
      this.expanded[node.path] = true;
      await this.loadChildren(node);
    },

    /* ---- 檔案列表 ---- */
    async selectDir(node) {
      this.selectedDirPath = node.path;
      this.selectedDir = { path: node.path, name: node.name };
      this.activeFile = null;
      await this.loadFiles();
    },

    async loadFiles() {
      if (!this.selectedDir) return;
      this.loadingFiles = true;
      try {
        const d = await this.api(`/api/files?path=${encodeURIComponent(this.selectedDir.path)}&hidden=${this.showHidden ? 1 : 0}`);
        this.files = d.files;
        // 清除已不存在的選取項目
        const paths = new Set(this.files.map((f) => f.path));
        const keep = {};
        for (const p of Object.keys(this.selectedSet)) if (paths.has(p)) keep[p] = true;
        this.selectedSet = keep;
      } catch (e) {
        this.showToast('讀取檔案失敗：' + e.message, 'err');
      } finally {
        this.loadingFiles = false;
      }
    },

    navTo(p) {
      const parts = this.splitPath(p);
      const name = parts.length ? parts[parts.length - 1] : p;
      this.selectDir({ path: p, name });
    },

    onRowClick(f, ev) {
      if (ev && (ev.ctrlKey || ev.metaKey)) { this.toggleSelect(f); return; } // Ctrl/⌘+點選切換複選
      if (f.isDir) {
        this.expanded[f.path] = true;
        this.loadChildren(f);
        this.selectDir(f);
      } else {
        this.activeFile = f.path;
      }
    },

    onRowDbl(f) {
      if (f.isDir) { this.onRowClick(f); }
      else { this.doOpen(f); }
    },

    /* ---- 作業：開啟／下載／備份／刪除 ---- */
    async doOpen(f) {
      try {
        const d = await this.api('/api/open', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: f.path }),
        });
        this.showToast(d.msg || '已嘗試開啟');
      } catch (e) {
        this.showToast('開啟失敗：' + e.message, 'err');
      }
    },

    doDownload(f) {
      window.open('/api/download?path=' + encodeURIComponent(f.path), '_blank');
    },

    async doBackup(f) {
      try {
        const d = await this.api('/api/backup', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: f.path }),
        });
        this.showToast(`已備份至 ${d.dest}`);
      } catch (e) {
        this.showToast('備份失敗：' + e.message, 'err');
      }
    },

    async doDelete(f) {
      const ok = confirm(`確定要刪除「${f.name}」嗎？此操作無法復原。`);
      if (!ok) return;
      try {
        await this.api('/api/delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: f.path }),
        });
        this.showToast(`已刪除 ${f.name}`);
        await this.loadFiles();
      } catch (e) {
        this.showToast('刪除失敗：' + e.message, 'err');
      }
    },

    /* ---- 複選操作 ---- */
    toggleSelect(f) {
      if (this.selectedSet[f.path]) delete this.selectedSet[f.path];
      else this.selectedSet[f.path] = true;
    },

    toggleSelectAll() {
      if (this.allSelected) this.clearSelection();
      else {
        for (const f of this.visibleFiles) this.selectedSet[f.path] = true;
      }
    },

    clearSelection() {
      this.selectedSet = {};
    },

    batchCopy() { this.openDestModal('copy', null); },
    batchMove() { this.openDestModal('move', null); },

    async batchBackup() {
      const paths = this.selectedPaths;
      if (!paths.length) return;
      try {
        const d = await this.api('/api/backup', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths }),
        });
        this.showToast(`已備份 ${d.backedUp} 個檔案至各自的 bak 資料夾`);
        this.clearSelection();
        await this.loadFiles();
      } catch (e) {
        this.showToast('備份失敗：' + e.message, 'err');
      }
    },

    async batchDelete() {
      const paths = this.selectedPaths;
      if (!paths.length) return;
      if (!confirm(`確定要刪除選取的 ${paths.length} 個項目嗎？此操作無法復原。`)) return;
      try {
        const d = await this.api('/api/delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths }),
        });
        this.showToast(`已刪除 ${d.deleted} 個項目`);
        this.clearSelection();
        await this.loadFiles();
      } catch (e) {
        this.showToast('刪除失敗：' + e.message, 'err');
      }
    },

    async batchDownload() {
      const paths = this.selectedPaths;
      if (!paths.length) return;
      try {
        const d = await this.api('/api/zip', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths }),
        });
        window.open(d.url, '_blank');
      } catch (e) {
        this.showToast('打包失敗：' + e.message, 'err');
      }
    },

    /* ---- 作業：複製／搬移（目的地選取） ---- */
    openDestModal(mode, f) {
      this.destModal.show = true;
      this.destModal.mode = mode;
      if (f) {
        this.destModal.src = f;
        this.destModal.srcs = null;
        this.destModal.srcName = f.name;
      } else {
        this.destModal.src = null;
        this.destModal.srcs = this.selectedPaths.slice();
        this.destModal.srcName = `選取的 ${this.destModal.srcs.length} 個項目`;
      }
      this.destModal.dest = '';
      this.destModal.destOk = false;
      this.destModal.destInfo = false;
    },

    closeDestModal() {
      this.destModal.show = false;
      this.destModal.src = null;
    },

    pickDest(node) {
      this.destModal.dest = node.path;
      this.validateDest();
    },

    async validateDest() {
      if (!this.destModal.dest) {
        this.destModal.destOk = false;
        this.destModal.destInfo = false;
        return;
      }
      this.destModal.destInfo = true;
      try {
        const d = await this.api('/api/stat?path=' + encodeURIComponent(this.destModal.dest));
        this.destModal.destOk = !!(d.exists && d.isDir && d.path !== (this.destModal.src && this.destModal.src.path));
      } catch {
        this.destModal.destOk = false;
      }
    },

    async confirmDest() {
      const mode = this.destModal.mode;
      const actionName = mode === 'copy' ? '複製' : '搬移';
      const srcs = this.destModal.src ? [this.destModal.src.path] : (this.destModal.srcs || []);
      try {
        const d = await this.api(`/api/${mode}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ srcs, destDir: this.destModal.dest }),
        });
        const n = d.copied || d.moved || srcs.length;
        this.showToast(`已${actionName} ${n} 個項目至 ${d.dest || this.destModal.dest}`);
        this.closeDestModal();
        this.clearSelection();
        await this.loadFiles();
      } catch (e) {
        this.showToast(`${actionName}失敗：${e.message}`, 'err');
      }
    },

    /* ---- 作業：預覽（文字／Markdown／HTML） ---- */
    isPreviewable(f) {
      return !f.isDir && /\.(txt|md|markdown|html?|xhtml)$/i.test(f.name);
    },

    async openPreview(f) {
      const kind = /\.(md|markdown)$/i.test(f.name) ? 'md'
        : /\.(html?|xhtml)$/i.test(f.name) ? 'html'
        : 'txt';
      this.preview.show = true;
      this.preview.name = f.name;
      this.preview.path = f.path;
      this.preview.kind = kind;
      this.preview.content = '';
      this.preview.rendered = '';
      this.preview.info = '';
      this.preview.error = '';
      this.preview.loading = true;
      try {
        const d = await this.api('/api/preview?path=' + encodeURIComponent(f.path));
        this.preview.content = d.content;
        if (kind === 'md') this.preview.rendered = this.renderMarkdown(d.content);
        this.preview.info = `${this.fmtSize(d.size)} ｜ ${this.fmtDate(d.mtime)}`;
      } catch (e) {
        this.preview.error = e.message;
      } finally {
        this.preview.loading = false;
      }
    },

    renderMarkdown(text) {
      const mdStyle = `<style>
        body { margin: 0; background: #fff; }
        .md-body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif;
                   line-height: 1.7; padding: 20px 28px; color: #1f2937; max-width: 880px; margin: 0 auto; }
        .md-body h1 { font-size: 1.7em; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px; }
        .md-body h2 { font-size: 1.4em; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
        .md-body h3 { font-size: 1.2em; }
        .md-body a { color: #2563eb; }
        .md-body code { background: #f3f4f6; padding: 2px 5px; border-radius: 4px; font-size: 0.9em; }
        .md-body pre { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; overflow: auto; }
        .md-body pre code { background: none; padding: 0; }
        .md-body blockquote { border-left: 4px solid #e5e7eb; margin: 0; padding: 2px 14px; color: #6b7280; }
        .md-body table { border-collapse: collapse; margin: 10px 0; }
        .md-body th, .md-body td { border: 1px solid #d1d5db; padding: 6px 12px; }
        .md-body th { background: #f9fafb; }
        .md-body img { max-width: 100%; }
        .md-body hr { border: none; border-top: 1px solid #e5e7eb; }
      </style><article class="md-body">`;
      const html = (typeof marked !== 'undefined' && typeof marked.parse === 'function')
        ? marked.parse(text)
        : '<pre>' + this.escapeHtml(text) + '</pre>';
      return mdStyle + html + '</article>';
    },

    escapeHtml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    closePreview() {
      this.preview.show = false;
    },

    openInNewTab() {
      if (this.preview.path) window.open('/api/download?path=' + encodeURIComponent(this.preview.path), '_blank');
    },

    /* ---- 分隔條拖曳（調整左右窗框寬度） ---- */
    startResize(e) {
      this.resizing = true;
      document.body.style.userSelect = 'none';
      const move = (ev) => {
        this.sidebarW = Math.min(Math.max(ev.clientX, 180), Math.floor(window.innerWidth * 0.7));
      };
      const up = () => {
        this.resizing = false;
        document.body.style.userSelect = '';
        try { localStorage.setItem('fm-sidebar-w', String(this.sidebarW)); } catch { /* 忽略 */ }
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },

    /* ---- 全域搜尋（Everything） ---- */
    async doSearch() {
      const q = this.searchQuery.trim();
      if (!q) { this.showToast('請輸入搜尋關鍵字', 'err'); return; }
      this.searchState.show = true;
      this.searchState.query = q;
      this.searchState.loading = true;
      this.searchState.error = '';
      this.searchState.items = [];
      this.searchState.info = '';
      try {
        const folder = (this.searchScopeFolder && this.selectedDir) ? this.selectedDir.path : '';
        const d = await this.api(`/api/search?q=${encodeURIComponent(q)}&limit=100&folder=${encodeURIComponent(folder)}`);
        this.searchState.engine = d.engine;
        this.searchState.items = d.items;
        this.searchState.info = `${d.total} 筆結果 ｜ ${d.tookMs}ms`;
      } catch (e) {
        this.searchState.engine = '';
        this.searchState.error = e.message;
      } finally {
        this.searchState.loading = false;
      }
    },

    closeSearch() {
      this.searchState.show = false;
    },

    onSearchClick(it) {
      if (it.isDir) this.selectDir(it);
      else this.doOpen(it);
    },

    /* ---- 喜好資料夾 ---- */
    async loadFavorites() {
      try {
        const d = await this.api('/api/favorites');
        this.favorites = d.favorites;
        this.rebuildFavSet();
      } catch (e) {
        this.showToast('載入喜好失敗：' + e.message, 'err');
      }
    },

    rebuildFavSet() {
      this.favSet = {};
      for (const f of this.favorites) this.favSet[f.path] = true;
    },

    isFav(p) { return !!this.favSet[p]; },

    async toggleFavorite(p) {
      const wasFav = this.isFav(p);
      try {
        const d = await this.api('/api/favorites', {
          method: wasFav ? 'DELETE' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: p }),
        });
        this.favorites = d.favorites;
        this.rebuildFavSet();
        if (this.selectedDir) await this.loadFiles(); // 重新整理星號狀態
        this.showToast(wasFav ? '已取消喜好' : '已加入喜好');
      } catch (e) {
        this.showToast('喜好操作失敗：' + e.message, 'err');
      }
    },

    switchFavs() {
      this.sidebarTab = 'favs';
      if (!this.favorites.length) this.loadFavorites();
    },

    /* ---- 最近異動 ---- */
    switchRecent() {
      this.sidebarTab = 'recent';
      this.loadRecent();
    },

    async loadRecent() {
      const days = Math.max(1, Math.min(365, parseInt(this.recentDays, 10) || 14));
      this.recentDays = days;
      try { localStorage.setItem('fm-recent-days', String(days)); } catch { /* 忽略 */ }
      this.recentLoading = true;
      this.recentError = '';
      try {
        const d = await this.api('/api/recent?days=' + days);
        this.recentItems = d.items;
      } catch (e) {
        this.recentError = e.message;
        this.recentItems = [];
      } finally {
        this.recentLoading = false;
      }
    },

    onRecentClick(it) {
      if (it.isDir) this.selectDir(it);
      else this.doOpen(it);
    },

    revealInDir(it) {
      const sep = it.path.includes('\\') ? '\\' : '/';
      const idx = it.path.lastIndexOf(sep);
      const parent = idx > 0 ? it.path.slice(0, idx) : sep;
      this.navTo(parent);
      if (it.isDir) {
        this.expanded[it.path] = true;
        this.loadChildren(it);
      } else {
        this.activeFile = it.path;
      }
    },

    folderIcon() {
      return wrapIcon(ICON_PATH.folder, '#f5b81f', 16);
    },

    /* ---- 更名 ---- */
    openRename(f) {
      this.renameModal.show = true;
      this.renameModal.path = f.path;
      this.renameModal.oldName = f.name;
      this.renameModal.newName = f.name;
      this.renameModal.error = '';
      this.$nextTick(() => {
        const el = this.$refs.renameInput;
        if (el) { el.focus(); el.select(); }
      });
    },

    closeRename() {
      this.renameModal.show = false;
    },

    async confirmRename() {
      const newName = this.renameModal.newName.trim();
      if (!newName || newName === this.renameModal.oldName) { this.closeRename(); return; }
      const oldPath = this.renameModal.path;
      try {
        const d = await this.api('/api/rename', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: oldPath, newName }),
        });
        // 若是喜好資料夾，同步更新路徑
        if (this.isFav(oldPath)) {
          await this.api('/api/favorites', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: oldPath }) });
          await this.api('/api/favorites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: d.path }) });
          await this.loadFavorites();
        }
        this.closeRename();
        this.showToast(`已更名為「${newName}」`);
        delete this.selectedSet[oldPath];
        await this.loadFiles();
      } catch (e) {
        this.renameModal.error = e.message;
      }
    },

    /* ---- 重新整理 ---- */
    async refresh() {
      await this.loadFiles();
      const jobs = Object.keys(this.expanded)
        .filter((p) => this.expanded[p])
        .map((p) => { delete this.dirCache[p]; return this.loadChildren({ path: p }); });
      await Promise.all(jobs);
    },

    async refreshAll() {
      const cur = this.selectedDir;
      this.expanded = {};
      this.dirCache = {};
      await this.loadRoots(false);
      if (cur) { this.selectedDirPath = cur.path; this.selectedDir = cur; }
      await this.loadFiles();
      this.showToast('已重新整理');
    },

    /* ---- 顯示格式化 ---- */
    fileIcon(f) {
      if (f.isDir) return wrapIcon(ICON_PATH.folder, '#f5b81f', 18);
      const t = TYPE_ICONS[EXT_MAP[f.ext] || 'generic'];
      return wrapIcon(t.path, t.color, 18);
    },

    fmtSize(n) {
      if (n == null) return '—';
      if (n === 0) return '0 B';
      const u = ['B', 'KB', 'MB', 'GB', 'TB'];
      let i = 0;
      while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
      return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
    },

    fmtDate(ms) {
      const d = new Date(ms);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
  },

  mounted() {
    this.loadRoots();
    this.loadFavorites();
    this.api('/api/meta').then((m) => { this.meta = m; }).catch(() => {});
  },

  template: TEMPLATES.root,
};

/* ================= tree-node 遞迴元件 ================= */

const treeNode = {
  name: 'tree-node',
  props: ['node', 'app', 'mode'],
  computed: {
    isExpanded() { return !!this.app.expanded[this.node.path]; },
    loading() { return !!this.app.treeLoading[this.node.path]; },
    error() { return !!this.app.treeErrors[this.node.path]; },
    children() { return this.app.dirCache[this.node.path] || []; },
    isSelected() { return this.app.selectedDirPath === this.node.path; },
    isPickDest() { return this.app.destModal.dest === this.node.path; },
    folderSvg() {
      return wrapIcon(ICON_PATH.folder, '#f5b81f', 16);
    },
  },
  methods: {
    onToggle() { this.app.toggleExpand(this.node); },
    onClick() { this.app.selectDir(this.node); },
    onPick() { this.app.pickDest(this.node); },
  },
  template: TEMPLATES.treeNode,
};

/* ================= 啟動 ================= */

const app = createApp(App);
app.component('tree-node', treeNode);
const rootProxy = app.mount('#app');
window.__APP__ = app; // 供除錯／測試使用
window.__ROOT__ = rootProxy; // 根元件 proxy（含所有 methods/data）
