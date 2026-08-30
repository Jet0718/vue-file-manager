#!/usr/bin/env node
/**
 * Vue 本機檔案管理系統 — Node.js 後端
 * 提供 REST API + 靜態檔案伺服（前端為 Vue 3，使用 Global Build，無需建置步驟）
 *
 * 啟動：node server.js  （預設 http://127.0.0.1:4321）
 */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { URL } = require('url');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
// 喜好等資料的存放目錄（測試可用 FM_DATA_DIR 隔離）
const DATA_DIR = process.env.FM_DATA_DIR ? path.resolve(process.env.FM_DATA_DIR) : path.join(ROOT, 'data');
const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');
const PORT = Number(process.env.PORT || 4321);
// 預設綁定位址：WSL 下綁 0.0.0.0，讓 Windows 瀏覽器可經由 localhost 轉發或 WSL IP 存取；
// 其他環境維持 127.0.0.1（僅本機可存取）。可用 HOST 環境變數覆寫。
const WSL = isWSL();
const HOST = process.env.HOST || (WSL ? '0.0.0.0' : '127.0.0.1');

/* ---------------- 工具函式 ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 10 * 1024 * 1024) {
        reject(new Error('請求內容過大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(new Error('JSON 解析失敗')); }
    });
    req.on('error', reject);
  });
}

/** 將路徑解析為絕對路徑；相對路徑以家目錄為基準 */
function resolvePath(p) {
  if (typeof p !== 'string' || !p.trim()) throw new Error('缺少路徑參數');
  p = p.trim();
  // 在 WSL 中自動把 Windows 路徑（C:\Users\xxx 或 C:/Users/xxx）轉為 /mnt/c/...
  if (isWSL()) {
    const w = toWslPath(p);
    if (w) return w;
  }
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(os.homedir(), p);
}

/* ---------------- WSL 支援 ---------------- */

/** 偵測是否在 WSL（Windows Subsystem for Linux）環境 */
function isWSL() {
  if (process.env.FM_FORCE_WSL === '1') return true; // 供測試強制啟用
  if (process.platform !== 'linux') return false;
  try {
    return fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
  } catch { return false; }
}

/** /mnt/c/Users/foo → C:\Users\foo（非 /mnt 路徑回傳 null） */
function toWindowsPath(p) {
  const m = p.match(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/);
  if (m) return `${m[1].toUpperCase()}:\\${(m[2] || '').replace(/\//g, '\\')}`;
  return null;
}

/** C:\Users\foo 或 C:/Users/foo → /mnt/c/Users/foo（非 Windows 路徑回傳 null） */
function toWslPath(p) {
  const m = p.match(/^([a-zA-Z]):[\\\/](.*)$/);
  if (m) return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
  return null;
}

/** 在 WSL 中以 Windows 預設應用程式開啟：優先 wslview，否則 explorer.exe + Windows 路徑 */
function openWsl(p) {
  return new Promise((resolve, reject) => {
    const win = toWindowsPath(p);
    const run = (cmd, args) => new Promise((res) => {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      child.on('error', () => res(false));
      child.on('spawn', () => { child.unref(); res(true); });
    });
    run('wslview', [p]).then((ok) => {
      if (ok) return resolve();
      if (win) {
        return run('explorer.exe', [win]).then((ok2) => {
          if (ok2) return resolve();
          reject(new Error('無法開啟：wslview 與 explorer.exe 皆不可用'));
        });
      }
      reject(new Error('無法將 WSL 路徑轉換為 Windows 路徑'));
    }).catch(reject);
  });
}

/* ---------------- 喜好資料夾（持久化於 data/favorites.json） ---------------- */

let favorites = new Set();

function loadFavorites() {
  try {
    const raw = JSON.parse(fs.readFileSync(FAVORITES_FILE, 'utf8'));
    if (Array.isArray(raw.paths)) favorites = new Set(raw.paths.map((p) => path.normalize(p)));
  } catch { favorites = new Set(); }
}

function saveFavorites() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FAVORITES_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ paths: [...favorites] }, null, 2));
    fs.renameSync(tmp, FAVORITES_FILE);
  } catch (e) { console.error('儲存喜好失敗：', e.message); }
}

function favoriteList() {
  const out = [];
  for (const p of favorites) {
    try {
      if (fs.statSync(p).isDirectory()) {
        out.push({ path: p, name: p === path.parse(p).root ? p : path.basename(p) });
      }
    } catch { /* 忽略已不存在的資料夾 */ }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant', { numeric: true }));
  return out;
}

/* ---------------- 最近異動掃描 ---------------- */

const RECENT_DEFAULT_DAYS = 14;   // 預設最近兩週
const RECENT_MAX_DEPTH = 4;
const RECENT_DRIVE_DEPTH = 2;     // WSL 磁碟掃描深度（避免太慢）
const RECENT_MAX_ITEMS = 200;
const RECENT_MAX_SCAN = 30000;    // 掃描節點上限
const RECENT_SKIP = new Set([
  'node_modules', '.git', '.cache', '.npm', 'AppData', '$Recycle.Bin',
  'System Volume Information', 'Library', '.Trash', 'lost+found', 'venv', '.venv',
  'target', 'dist', 'build', 'Program Files', 'Program Files (x86)', 'Windows',
  'PerfLogs', 'Recovery', 'Config.Msi', '$SysReset', 'Documents and Settings',
  'OneDriveTemp', 'Pools', 'swapfile.sys', 'pagefile.sys', 'hiberfil.sys',
  'site-packages', 'node_modules', '.pnpm',
]);

function recentRoots() {
  // 測試用：FM_RECENT_ROOTS="路徑:深度,路徑:深度"
  if (process.env.FM_RECENT_ROOTS) {
    return process.env.FM_RECENT_ROOTS.split(',').map((s) => {
      const [p, d] = s.split(':');
      return { p: p.trim(), depth: Number(d) || RECENT_MAX_DEPTH };
    });
  }
  const home = os.homedir();
  const roots = [{ p: home, depth: RECENT_MAX_DEPTH }];
  for (const c of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos',
    '桌面', '文件', '下載', '圖片', '音樂', '影片']) {
    const p = path.join(home, c);
    if (isDir(p)) roots.push({ p, depth: RECENT_MAX_DEPTH });
  }
  if (isWSL()) {
    try {
      for (const d of fs.readdirSync('/mnt')) {
        if (/^[a-z]$/i.test(d) && isDir(`/mnt/${d}`)) roots.push({ p: `/mnt/${d}`, depth: RECENT_DRIVE_DEPTH });
      }
    } catch { /* 忽略 */ }
  }
  return roots;
}

async function scanRecent(root, cutoff, depth, maxDepth, collected, state) {
  if (depth > maxDepth || state.scanned >= RECENT_MAX_SCAN || collected.length >= RECENT_MAX_ITEMS * 4) return;
  let entries;
  try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch { return; }
  state.scanned += entries.length;
  const jobs = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;              // 略過隱藏檔
    if (e.isDirectory() && RECENT_SKIP.has(e.name)) continue;
    const full = path.join(root, e.name);
    const job = (async () => {
      let st = null;
      try { st = await fsp.stat(full); } catch { return; }
      const isDirFlag = e.isDirectory();
      if (st.mtimeMs >= cutoff) {
        collected.push({
          name: e.name,
          path: full,
          isDir: isDirFlag,
          size: isDirFlag ? 0 : st.size,
          mtime: st.mtimeMs,
          ext: isDirFlag ? '' : path.extname(e.name).slice(1).toLowerCase(),
        });
      }
      if (isDirFlag) jobs.push(scanRecent(full, cutoff, depth + 1, maxDepth, collected, state));
    })();
    await job;
  }
  await Promise.all(jobs);
}

let recentCache = null; // { key, at, data }，30 秒快取避免頻繁全盤掃描

/* ---------------- Everything 全域搜尋 ---------------- */

const ES_EXE = path.join(ROOT, 'bin', 'es.exe');
let searchStatusCache = null; // { at, data }，10 秒快取

function runEs(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ES_EXE, args, { windowsHide: true });
    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`es.exe 退出碼 ${code}`));
      resolve(Buffer.concat(chunks));
    });
  });
}

/** Windows FILETIME（1601 年起 100ns 間隔）→ Unix 毫秒 */
function filetimeToMs(ft) {
  return Math.floor(ft / 10000) - 11644473600000;
}

/** 將 es.exe 的一筆結果轉為應用程式項目（路徑轉成 WSL 路徑） */
function esItemToEntry(r) {
  // 資料夾結果的 filename 結尾帶反斜線，先去除再取最後一段
  const winPath = (r.filename || '').replace(/\\+$/, '');
  const name = winPath.split('\\').pop() || winPath;
  const isDirFlag = (r.attributes & 0x10) !== 0;
  const wsl = toWslPath(winPath);
  return {
    name,
    path: wsl || winPath, // 無法轉換時保留原始 Windows 路徑
    isDir: isDirFlag,
    size: isDirFlag ? 0 : (r.size || 0),
    mtime: r.date_modified ? filetimeToMs(r.date_modified) : 0,
    ext: isDirFlag ? '' : path.extname(name).slice(1).toLowerCase(),
  };
}

async function searchEverything(q, limit, folder) {
  // 用 -export-json 匯出到暫存檔：匯出檔為完整 UTF-8，避免 stdout 轉碼把中文路徑變成 ?
  const tmpFile = path.join(os.tmpdir(), `fm-es-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  // 資料夾範圍改用「全域搜尋＋路徑前綴過濾」：WSL→Windows 參數轉換會破壞引號（path:"..."），
  // 且含空格的資料夾路徑無法可靠傳遞；全域搜尋取較多筆再以 WSL 路徑前綴過濾。
  const internalLimit = folder ? Math.max(500, limit) : limit;
  const args = ['-export-json', tmpFile, '-n', String(internalLimit), '-size', '-date-modified', '-attributes'];
  // WSL→Windows 的參數轉換對含空格的單一參數有缺陷，改為拆分後分開傳參（es.exe 會以空格合併尾部參數）
  args.push(...q.trim().split(/\s+/).filter(Boolean));
  try {
    await runEs(args);
    let arr = [];
    try { arr = JSON.parse(fs.readFileSync(tmpFile, 'utf8')); } catch { /* 解析失敗視為無結果 */ }
    let items = arr
      .map(esItemToEntry)
      .filter((it) => it.name);
    if (folder) {
      const prefix = folder.replace(/[\\/]+$/, '');
      items = items.filter((it) => it.path.startsWith(prefix + '/'));
    }
    return items.sort((a, b) => b.mtime - a.mtime).slice(0, limit); // 修改日期新 → 舊
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* 忽略 */ }
  }
}

/** 本機搜尋（Everything 不可用時的降級方案） */
async function searchLocal(q, limit, folder) {
  const collected = [];
  const state = { scanned: 0 };
  const needle = q.toLowerCase();
  const roots = folder ? [{ p: folder, depth: 6 }] : recentRoots();
  const walk = async (root, depth, maxDepth) => {
    if (depth > maxDepth || state.scanned >= 50000 || collected.length >= limit * 4) return;
    let entries;
    try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch { return; }
    state.scanned += entries.length;
    const jobs = [];
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory() && RECENT_SKIP.has(e.name)) continue;
      const full = path.join(root, e.name);
      const job = (async () => {
        let st = null;
        try { st = await fsp.stat(full); } catch { return; }
        const isDirFlag = e.isDirectory();
        if (e.name.toLowerCase().includes(needle)) {
          collected.push({
            name: e.name, path: full, isDir: isDirFlag,
            size: isDirFlag ? 0 : st.size, mtime: st.mtimeMs,
            ext: isDirFlag ? '' : path.extname(e.name).slice(1).toLowerCase(),
          });
        }
        if (isDirFlag) jobs.push(walk(full, depth + 1, maxDepth));
      })();
      await job;
    }
    await Promise.all(jobs);
  };
  await Promise.all(roots.map((r) => walk(r.p, 0, r.depth)));
  collected.sort((a, b) => b.mtime - a.mtime);
  return collected.slice(0, limit);
}

async function everythingStatus() {
  if (!fs.existsSync(ES_EXE)) return { available: false, engine: null, reason: '未找到 es.exe（bin/es.exe）' };
  try {
    await runEs(['-json', '-n', '1', 'fm_never_match_zzz_98765']);
    return { available: true, engine: 'everything', reason: null };
  } catch {
    return { available: false, engine: null, reason: 'Everything 未在執行（請先啟動 Everything）' };
  }
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

/** 避免覆蓋已存在檔案：在檔名後加上 (1)、(2)… */
async function uniqueDest(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let dest = path.join(dir, name);
  let i = 1;
  while (fs.existsSync(dest)) {
    dest = path.join(dir, `${base} (${i})${ext}`);
    i++;
  }
  return dest;
}

/* ---------------- 備份（封存標記 A 過濾 ＋ 全備份／差異備份） ---------------- */

const BAK_DIR = '.bak';                   // 備份壓縮檔存放資料夾（位於目前資料夾下）
const HISTORY_NAME = '.backup-history.json'; // 備份歷程記錄文件（位於目前資料夾下）
const PS_EXE = 'powershell.exe';          // 查詢 Windows 封存標記用

/** 備份 zip 命名用的年月日時分秒：YYYYMMDDHHmmss */
function backupStamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** 執行 Windows 指令並取得 stdout（回傳原始 Buffer，由呼叫端決定編碼） */
function runWin(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    const chunks = [];
    let err = '';
    child.stdout.on('data', (c) => { chunks.push(c); });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`${cmd} 退出碼 ${code}：${err.trim()}`));
      resolve(Buffer.concat(chunks));
    });
  });
}

/**
 * 以 PowerShell 批次查詢 Windows 檔案的封存標記（A）。
 * 回傳 Map：Windows 絕對路徑（小寫、反斜線）→ 是否有 A。
 * 路徑以 UTF-8 輸出，避免中文檔名在傳統 attrib 輸出下變亂碼。
 */
async function queryWinArchiveFlags(winPaths) {
  const flags = new Map();
  const CHUNK = 80; // 控制單次命令列長度
  for (let i = 0; i < winPaths.length; i += CHUNK) {
    const chunk = winPaths.slice(i, i + CHUNK);
    const lit = chunk.map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
    const script =
      '$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
      `Get-Item -LiteralPath ${lit} -ErrorAction SilentlyContinue |` +
      "ForEach-Object { $_.FullName + '|' + $_.Attributes }";
    const out = await runWin(PS_EXE, ['-NoProfile', '-Command', script]);
    for (const line of out.toString('utf8').split(/\r?\n/)) {
      const idx = line.lastIndexOf('|');
      if (idx <= 0) continue;
      const full = line.slice(0, idx).trim();
      const attrs = line.slice(idx + 1).trim();
      flags.set(full.toLowerCase().replace(/\//g, '\\'), attrs.includes('Archive'));
    }
  }
  return flags;
}

/**
 * 過濾出具有封存標記（A）的檔案。
 * 非 Windows 磁碟（如 /home、/tmp 等 Linux 檔案系統）沒有 Windows 屬性，視為皆有標記。
 */
async function filterArchiveFlagged(files) {
  const winFiles = [];
  const others = [];
  for (const f of files) {
    const win = toWindowsPath(f.abs);
    if (win) winFiles.push({ f, win });
    else others.push(f);
  }
  const marked = others.slice();
  if (winFiles.length) {
    let flags = new Map();
    try { flags = await queryWinArchiveFlags(winFiles.map((x) => x.win)); }
    catch { /* 查詢失敗時全部視為有標記，避免漏備份 */ }
    for (const { f, win } of winFiles) {
      const v = flags.get(win.toLowerCase().replace(/\//g, '\\'));
      if (v === undefined || v) marked.push(f); // 查不到結果時保守視為有標記
    }
  }
  return marked;
}

/**
 * 收集選取項目下的所有檔案（子資料夾遞迴），回傳 [{ rel, abs, size, mtime }]。
 * rel 為相對「目前資料夾」的路徑（zip 內條目名）；自動略過 .bak 資料夾與備份歷程文件。
 */
async function collectBackupFiles(scopeDir, paths) {
  const seen = new Set();
  const out = [];
  const visit = async (abs, rel) => {
    let st;
    try { st = await fsp.stat(abs); } catch { return; }
    if (st.isDirectory()) {
      let entries;
      try { entries = await fsp.readdir(abs, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const lower = e.name.toLowerCase();
        if (lower === BAK_DIR.toLowerCase() || e.name === HISTORY_NAME) continue;
        await visit(path.join(abs, e.name), rel ? `${rel}/${e.name}` : e.name);
      }
    } else if (!seen.has(abs)) {
      seen.add(abs);
      out.push({ rel, abs, size: st.size, mtime: st.mtimeMs });
    }
  };
  for (const p of paths) {
    let abs;
    try {
      // 相對路徑以「目前資料夾」為基準解析（前端一律送絕對路徑）
      abs = path.isAbsolute(p) ? resolvePath(p) : path.resolve(scopeDir, p);
    } catch { continue; }
    if (!fs.existsSync(abs) || abs === scopeDir) continue;
    const base = path.basename(abs);
    if (base.toLowerCase() === BAK_DIR.toLowerCase() || base === HISTORY_NAME) continue;
    await visit(abs, base);
  }
  return out;
}

/** 避免 zip 檔名衝突：同秒同前綴時在檔名後加 -1、-2… */
function uniqueZipName(bakDir, base) {
  let name = base;
  let i = 1;
  while (fs.existsSync(path.join(bakDir, name))) {
    name = `${base.slice(0, -4)}-${i}${base.slice(-4)}`;
    i++;
  }
  return name;
}

/** 讀取備份歷程記錄（不存在或格式錯誤回傳 null） */
function loadBackupHistory(scopeDir) {
  try {
    const h = JSON.parse(fs.readFileSync(path.join(scopeDir, HISTORY_NAME), 'utf8'));
    if (h && typeof h === 'object' && h.files && typeof h.files === 'object') return h;
  } catch { /* 無歷程 */ }
  return null;
}

/** 寫入備份歷程記錄（先寫暫存檔再更名，避免中斷造成半份檔案） */
function saveBackupHistory(scopeDir, hist) {
  const file = path.join(scopeDir, HISTORY_NAME);
  fs.writeFileSync(file + '.tmp', JSON.stringify(hist, null, 2));
  fs.renameSync(file + '.tmp', file);
}

/** 串流計算檔案 sha256（差異比對用） */
function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p);
    s.on('data', (d) => h.update(d));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

/** 批次清除 Windows 檔案的封存標記（A），回傳嘗試清除的數量 */
async function clearWinArchiveFlags(winPaths) {
  const CHUNK = 80;
  let cleared = 0;
  for (let i = 0; i < winPaths.length; i += CHUNK) {
    const chunk = winPaths.slice(i, i + CHUNK);
    const lit = chunk.map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
    const script =
      `Get-Item -LiteralPath ${lit} -ErrorAction SilentlyContinue |` +
      'ForEach-Object { $_.Attributes = $_.Attributes -band (-bnot [IO.FileAttributes]::Archive) }';
    await runWin(PS_EXE, ['-NoProfile', '-Command', script]);
    cleared += chunk.length;
  }
  return cleared;
}

/* ---------------- 壓縮檔（ZIP/TAR/RAR/7Z）預覽與還原 ---------------- */

/** 路徑穿越防護：壓縮檔條目相對路徑 → 安全目標路徑（拒絕 .. 與絕對路徑） */
function safeArchivePath(destDir, rel) {
  const norm = String(rel).replace(/\\/g, '/');
  const parts = norm.split('/').filter((s) => s && s !== '.');
  if (parts.some((s) => s === '..') || /^[a-zA-Z]:/.test(norm) || norm.startsWith('/')) {
    throw new Error(`不安全的壓縮檔條目：${rel}`);
  }
  const full = path.resolve(destDir, ...parts);
  if (full !== path.resolve(destDir) && !full.startsWith(path.resolve(destDir) + path.sep)) {
    throw new Error(`不安全的壓縮檔條目：${rel}`);
  }
  return full;
}

/** 解碼 zip 條目名稱：優先 UTF-8，其次 Big5（傳統 Windows 壓縮工具），最後 latin1 */
function decodeZipName(bytes, flag) {
  if (flag & 0x800) return bytes.toString('utf8');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch {
    try { return new TextDecoder('big5').decode(bytes); }
    catch { return bytes.toString('latin1'); }
  }
}

/** 解碼外部工具（bsdtar 等）輸出：可能為 cp950（Big5）或 UTF-8 */
function decodeExternalName(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch {
    try { return new TextDecoder('big5').decode(bytes); }
    catch { return bytes.toString('latin1'); }
  }
}

/** 讀取 zip 中央目錄（僅讀取必要區段，記憶體友善） */
async function readZipCentral(fd, size) {
  const tail = Math.min(size, 65557);
  const buf = Buffer.alloc(tail);
  await fd.read(buf, 0, tail, size - tail);
  let eocd = -1;
  for (let i = tail - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP 格式錯誤（找不到目錄）');
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  const cd = Buffer.alloc(cdSize);
  await fd.read(cd, 0, cdSize, cdOff);
  return { cd, count };
}

function parseCentral(cd, count) {
  const entries = [];
  let off = 0;
  for (let i = 0; i < count && off + 46 <= cd.length; i++) {
    if (cd.readUInt32LE(off) !== 0x02014b50) break;
    const flag = cd.readUInt16LE(off + 8);
    const method = cd.readUInt16LE(off + 10);
    const crc = cd.readUInt32LE(off + 16);
    const csize = cd.readUInt32LE(off + 20);
    const usize = cd.readUInt32LE(off + 24);
    const nameLen = cd.readUInt16LE(off + 28);
    const extraLen = cd.readUInt16LE(off + 30);
    const commentLen = cd.readUInt16LE(off + 32);
    const localOff = cd.readUInt32LE(off + 42);
    const name = decodeZipName(cd.subarray(off + 46, off + 46 + nameLen), flag);
    entries.push({ name, method, crc, csize, usize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** 讀取單一 zip 條目的解壓內容 */
async function readZipEntryData(fd, entry) {
  const head = Buffer.alloc(30);
  await fd.read(head, 0, 30, entry.localOff);
  if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('ZIP 結構錯誤（local header）');
  const nameLen = head.readUInt16LE(26);
  const extraLen = head.readUInt16LE(28);
  const dataStart = entry.localOff + 30 + nameLen + extraLen;
  const comp = Buffer.alloc(entry.csize);
  await fd.read(comp, 0, entry.csize, dataStart);
  const raw = entry.method === 8 ? zlib.inflateRawSync(comp) : comp;
  if (entry.crc && crc32(raw) !== entry.crc) throw new Error(`CRC 不符：${entry.name}`);
  return raw;
}

/** 列出 zip 內容 */
async function listZipEntries(zipPath) {
  const fd = await fsp.open(zipPath, 'r');
  try {
    const size = (await fd.stat()).size;
    const { cd, count } = await readZipCentral(fd, size);
    return parseCentral(cd, count).map((e) => ({
      name: e.name,
      size: e.usize,
      compressed: e.csize,
      method: e.method === 8 ? 'deflate' : 'store',
      isDir: /\/$/.test(e.name),
    }));
  } finally { await fd.close(); }
}

/** 還原 zip：逐條目解壓至 destDir（含路徑穿越防護與 CRC 驗證） */
async function extractZip(zipPath, destDir, overwrite) {
  const fd = await fsp.open(zipPath, 'r');
  let restored = 0, skipped = 0;
  const errors = [];
  try {
    const size = (await fd.stat()).size;
    const { cd, count } = await readZipCentral(fd, size);
    for (const e of parseCentral(cd, count)) {
      if (/\/$/.test(e.name)) continue; // 目錄條目
      try {
        const dest = safeArchivePath(destDir, e.name);
        if (!overwrite && fs.existsSync(dest)) { skipped++; continue; }
        const data = await readZipEntryData(fd, e);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, data);
        restored++;
      } catch (err) { errors.push(`${e.name}：${err.message}`); }
    }
  } finally { await fd.close(); }
  return { restored, skipped, errors };
}

/** 循序走訪 tar（支援 GNU 長檔名），onEntry 回 false 可中止 */
async function walkTar(fd, size, onEntry) {
  let off = 0;
  let pendingName = null;
  const block = Buffer.alloc(512);
  while (off + 512 <= size) {
    await fd.read(block, 0, 512, off);
    if (block.every((b) => b === 0)) break;
    const name = block.toString('utf8', 0, 100).split('\0')[0];
    const sizeStr = block.toString('utf8', 124, 136).replace(/[^0-7]/g, '');
    const sz = parseInt(sizeStr, 8) || 0;
    const type = String.fromCharCode(block[156] || 48);
    const prefix = block.toString('utf8', 345, 500).split('\0')[0];
    const dataOff = off + 512;
    if (type === 'L') { // GNU 長檔名：資料區即真實檔名
      const nameBuf = Buffer.alloc(sz);
      await fd.read(nameBuf, 0, sz, dataOff);
      pendingName = nameBuf.toString('utf8').split('\0')[0];
      off += 512 + Math.ceil(sz / 512) * 512;
      continue;
    }
    const full = pendingName || (prefix ? `${prefix}/${name}` : name);
    pendingName = null;
    const cont = await onEntry({ name: full, size: sz, type, dataOff, blockSize: Math.ceil(sz / 512) * 512 });
    if (cont === false) break;
    off = dataOff + Math.ceil(sz / 512) * 512;
  }
}

/** 列出 tar 內容 */
async function listTarEntries(tarPath) {
  const fd = await fsp.open(tarPath, 'r');
  const entries = [];
  try {
    const size = (await fd.stat()).size;
    await walkTar(fd, size, (e) => { entries.push({ name: e.name, size: e.size, compressed: e.size, method: 'tar', isDir: e.type === '5' }); });
  } finally { await fd.close(); }
  return entries;
}

/** 還原 tar */
async function extractTar(tarPath, destDir, overwrite) {
  const fd = await fsp.open(tarPath, 'r');
  let restored = 0, skipped = 0;
  const errors = [];
  try {
    const size = (await fd.stat()).size;
    await walkTar(fd, size, async (e) => {
      try {
        const dest = safeArchivePath(destDir, e.name);
        if (e.type === '5') { await fsp.mkdir(dest, { recursive: true }); return; }
        if (e.type !== '0' && e.type !== '') return; // 略過符號連結等特殊型別
        if (!overwrite && fs.existsSync(dest)) { skipped++; return; }
        const data = Buffer.alloc(e.size);
        await fd.read(data, 0, e.size, e.dataOff);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, data);
        restored++;
      } catch (err) { errors.push(`${e.name}：${err.message}`); }
    });
  } finally { await fd.close(); }
  return { restored, skipped, errors };
}

/** 尋找可讀取 RAR/7Z 的外部工具：優先 7-Zip，否則 Windows tar.exe（bsdtar） */
function findArchiveTool() {
  const fixed = ['/mnt/c/Program Files/7-Zip/7z.exe', 'C:\\Program Files\\7-Zip\\7z.exe'];
  for (const p of fixed) if (fs.existsSync(p)) return { cmd: p, kind: '7z' };
  const names = ['7z', '7zz', 'tar.exe', 'tar'];
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  for (const n of names) {
    for (const dir of pathDirs) {
      try {
        const p = path.join(dir, n);
        if (fs.existsSync(p)) return { cmd: p, kind: n.startsWith('tar') ? 'tar' : '7z' };
      } catch { /* 忽略無效路徑 */ }
    }
  }
  return null;
}

/** 以外部工具列出 RAR/7Z 內容 */
async function listExternalArchive(p, ext) {
  const tool = findArchiveTool();
  if (!tool) throw new Error('系統缺少可讀取此格式的工具（需 7-Zip 或 Windows tar.exe）');
  const win = toWindowsPath(p) || p;
  if (tool.kind === '7z') {
    const out = (await runWin(tool.cmd, ['l', '-slt', win])).toString('utf8');
    const entries = [];
    let cur = null;
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^Path = (.*)$/);
      if (m) { cur = { name: m[1], size: 0, compressed: 0, method: ext.toUpperCase(), isDir: /\/$/.test(m[1]) }; entries.push(cur); continue; }
      const ms = line.match(/^Size = (\d+)$/);
      if (ms && cur) cur.size = Number(ms[1]);
      const mc = line.match(/^Packed Size = (\d+)$/);
      if (mc && cur) cur.compressed = Number(mc[1]);
    }
    if (!entries.length) throw new Error('7-Zip 無法列出內容');
    return entries;
  }
  const out = await runWin(tool.cmd, ['-tf', win]);
  const entries = [];
  for (const line of out.toString('utf8').split(/\r?\n/)) {
    const name = line.replace(/\/$/, '');
    if (!name.trim() || name === win) continue;
    entries.push({ name: decodeExternalName(Buffer.from(line, 'utf8')), size: 0, compressed: 0, method: ext.toUpperCase(), isDir: line.endsWith('/') });
  }
  if (!entries.length) throw new Error('無法列出壓縮檔內容');
  return entries;
}

/** 遞迴走訪資料夾，回傳 [{ rel, abs, isDir }] */
async function walkDirTree(root) {
  const out = [];
  const visit = async (abs, rel) => {
    let st;
    try { st = await fsp.stat(abs); } catch { return; }
    if (st.isDirectory()) {
      out.push({ rel, abs, isDir: true });
      let entries;
      try { entries = await fsp.readdir(abs, { withFileTypes: true }); } catch { return; }
      for (const e of entries) await visit(path.join(abs, e.name), rel ? `${rel}/${e.name}` : e.name);
    } else {
      out.push({ rel, abs, isDir: false });
    }
  };
  await visit(root, '');
  return out;
}

/** 以外部工具還原 RAR/7Z：先解壓至暫存夾再依規則搬移（覆蓋／跳過、路徑防護） */
async function extractExternalArchive(p, ext, destDir, overwrite) {
  const tool = findArchiveTool();
  if (!tool) throw new Error('系統缺少可解壓此格式的工具（需 7-Zip 或 Windows tar.exe）');
  const win = toWindowsPath(p) || p;
  const tmp = path.join(destDir, `.restore-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fsp.mkdir(tmp, { recursive: true });
  let restored = 0, skipped = 0;
  const errors = [];
  try {
    const winTmp = toWindowsPath(tmp) || tmp;
    if (tool.kind === '7z') await runWin(tool.cmd, ['x', '-y', `-o${winTmp}`, win]);
    else await runWin(tool.cmd, ['-xf', win, '-C', winTmp]);
    for (const { rel, abs, isDir } of await walkDirTree(tmp)) {
      if (!rel) continue;
      try {
        const dest = safeArchivePath(destDir, rel);
        if (isDir) { await fsp.mkdir(dest, { recursive: true }); continue; }
        if (!overwrite && fs.existsSync(dest)) { skipped++; continue; }
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.copyFile(abs, dest);
        restored++;
      } catch (err) { errors.push(`${rel}：${err.message}`); }
    }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
  return { restored, skipped, errors };
}

/** 依副檔名列出壓縮檔內容 */
async function listArchiveEntries(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.zip') return listZipEntries(p);
  if (ext === '.tar') return listTarEntries(p);
  if (ext === '.rar' || ext === '.7z') return listExternalArchive(p, ext);
  throw new Error('僅支援 ZIP / RAR / 7Z / TAR 壓縮檔');
}

/** 依副檔名還原壓縮檔至 destDir */
async function extractArchive(p, destDir, overwrite) {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.zip') return extractZip(p, destDir, overwrite);
  if (ext === '.tar') return extractTar(p, destDir, overwrite);
  if (ext === '.rar' || ext === '.7z') return extractExternalArchive(p, ext, destDir, overwrite);
  throw new Error('僅支援 ZIP / RAR / 7Z / TAR 壓縮檔');
}

/** 還原預設目標：壓縮檔若位於 .bak 資料夾內，則還原至其上一層（原始備份目錄） */
function defaultRestoreDir(zipPath) {
  const parent = path.dirname(zipPath);
  return path.basename(parent).toLowerCase() === BAK_DIR.toLowerCase()
    ? path.dirname(parent)
    : parent;
}

/* ---------------- 重整：找尋內容重複的檔案（去重） ---------------- */

const DEDUP_MAX_SCAN = 50000; // 掃描節點上限，避免大型目錄卡死

/**
 * 掃描目前資料夾與子目錄，找出內容相同的重複檔案。
 * 先依檔案長度（大小）分組，僅對同大小檔案再比對 sha256 內容雜湊。
 * 每組預設勾選「檔名較長者」：保留檔名最短的檔案，其餘標記 defaultChecked。
 */
async function scanDuplicates(rootDir) {
  const files = []; // { path, name, size, mtime }
  let scanned = 0;
  const visit = async (abs) => {
    if (scanned >= DEDUP_MAX_SCAN) return;
    let entries;
    try { entries = await fsp.readdir(abs, { withFileTypes: true }); } catch { return; }
    scanned += entries.length;
    for (const e of entries) {
      if (scanned >= DEDUP_MAX_SCAN) return;
      if (e.name.startsWith('.')) continue;             // 略過隱藏檔／.bak／歷程文件
      if (e.isDirectory()) {
        if (RECENT_SKIP.has(e.name)) continue;          // 略過 node_modules 等雜訊目錄
        await visit(path.join(abs, e.name));
      } else {
        const full = path.join(abs, e.name);
        let st;
        try { st = await fsp.stat(full); } catch { continue; }
        files.push({ path: full, name: e.name, size: st.size, mtime: st.mtimeMs });
      }
    }
  };
  await visit(rootDir);

  // 第一步：依檔案長度（大小）分組，只保留大小重複的
  const bySize = new Map();
  for (const f of files) {
    if (!bySize.has(f.size)) bySize.set(f.size, []);
    bySize.get(f.size).push(f);
  }

  // 第二步：同大小的檔案再比對 sha256 內容雜湊
  const groups = [];
  for (const [size, list] of bySize) {
    if (list.length < 2) continue;
    const byHash = new Map();
    for (const f of list) {
      let h;
      try { h = await sha256File(f.path); } catch { continue; }
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(f);
    }
    for (const [hash, fl] of byHash) {
      if (fl.length < 2) continue;
      // 檔名最短者保留；其餘（檔名較長者）預設勾選為刪除對象
      fl.sort((a, b) => (a.name.length - b.name.length) || a.name.localeCompare(b.name, 'zh-Hant'));
      const keep = fl[0];
      groups.push({
        size,
        hash,
        files: fl.map((f) => ({
          path: f.path,
          name: f.name,
          size: f.size,
          mtime: f.mtime,
          defaultChecked: f !== keep,
        })),
      });
    }
  }
  groups.sort((a, b) => b.size - a.size); // 大檔案優先呈現
  return groups;
}

/** 遞迴複製資料夾 */
async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fsp.copyFile(s, d);
  }
}

/* ---------------- ZIP 打包（無壓縮、純儲存） ---------------- */

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate());
  return { time, date };
}

/** 收集選取項目（資料夾遞迴展開）為 zip 條目 */
function collectZipEntries(p, prefix, out) {
  let st;
  try { st = fs.statSync(p); } catch { return; }
  const base = path.basename(p);
  const zipName = prefix ? `${prefix}/${base}` : base;
  if (st.isDirectory()) {
    out.push({ zipName: zipName + '/', fsPath: null });
    let children;
    try { children = fs.readdirSync(p); } catch { return; }
    for (const c of children) collectZipEntries(path.join(p, c), zipName, out);
  } else {
    out.push({ zipName, fsPath: p });
  }
}

/** 建立 ZIP（deflate 壓縮，選用 withHashes 時一併回傳各條目 sha256）
 *  回傳 Buffer；opts.withHashes 為 true 時回傳 { buf, hashes } */
function buildZip(entries, opts = {}) {
  const withHashes = !!opts.withHashes;
  const hashes = new Map();
  const chunks = [];
  const central = [];
  let offset = 0;
  const enc = new TextEncoder();
  const dt = dosDateTime(new Date());
  for (const e of entries) {
    const nameBytes = enc.encode(e.zipName);
    const data = e.fsPath ? fs.readFileSync(e.fsPath) : Buffer.alloc(0);
    const crc = crc32(data);
    let method = 0;
    let payload = data;
    if (data.length) {
      const deflated = zlib.deflateRawSync(data);
      if (deflated.length < data.length) { method = 8; payload = deflated; } // 壓縮無益時改純儲存
    }
    if (withHashes && e.fsPath) hashes.set(e.zipName, crypto.createHash('sha256').update(data).digest('hex'));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);       // version needed
    local.writeUInt16LE(0x0800, 6);   // flag：UTF-8 檔名
    local.writeUInt16LE(method, 8);   // method：8=deflate，0=store
    local.writeUInt16LE(dt.time, 10);
    local.writeUInt16LE(dt.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);  // 壓縮後大小
    local.writeUInt32LE(data.length, 22);     // 原始大小
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, payload);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(dt.time, 12);
    cd.writeUInt16LE(dt.date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(e.fsPath ? 0 : 0x10, 38); // external attrs（資料夾標記）
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBytes);
    offset += local.length + nameBytes.length + payload.length;
  }
  const cdStart = offset;
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);
  const buf = Buffer.concat([...chunks, ...central, eocd]);
  return withHashes ? { buf, hashes } : buf;
}

/** 待下載的 ZIP 暫存（token → { at, file }），10 分鐘後清除 */
const pendingZips = new Map();
function prunePendingZips() {
  const now = Date.now();
  for (const [k, v] of pendingZips) {
    if (now - v.at > 10 * 60 * 1000) {
      try { fs.unlinkSync(v.file); } catch { /* 忽略 */ }
      pendingZips.delete(k);
    }
  }
}

/* ---------------- 常用目錄 ---------------- */

function commonRoots() {
  const home = os.homedir();
  const roots = [{ path: home, name: '家目錄（Home）' }];
  const seen = new Set([home]);
  const candidates = [
    'Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos',
    '桌面', '文件', '下載', '圖片', '音樂', '影片',
  ];
  for (const c of candidates) {
    const p = path.join(home, c);
    try {
      if (fs.statSync(p).isDirectory() && !seen.has(p)) {
        roots.push({ path: p, name: c });
        seen.add(p);
      }
    } catch { /* 目錄不存在則略過 */ }
  }
  if (process.platform === 'linux') {
    roots.push({ path: '/', name: '根目錄（/）' });
    // WSL：加入 Windows 磁碟（/mnt/c、/mnt/d …）
    if (isWSL()) {
      try {
        for (const d of fs.readdirSync('/mnt')) {
          if (/^[a-z]$/i.test(d) && isDir(`/mnt/${d}`)) {
            roots.push({ path: `/mnt/${d}`, name: `Windows 磁碟 ${d.toUpperCase()}:` });
          }
        }
      } catch { /* 忽略 */ }
    }
  } else if (process.platform === 'win32') {
    for (let i = 65; i <= 90; i++) {
      const drive = `${String.fromCharCode(i)}:\\`;
      if (isDir(drive)) roots.push({ path: drive, name: drive });
    }
  } else if (process.platform === 'darwin') {
    roots.push({ path: '/', name: '根目錄（/）' });
  }
  return roots;
}

/* ---------------- 檔案列舉 ---------------- */

function readDirEntries(dirPath, showHidden) {
  return new Promise((resolve, reject) => {
    fs.readdir(dirPath, { withFileTypes: true }, (err, entries) => {
      if (err) return reject(err);
      const jobs = entries
        .filter((e) => showHidden || !e.name.startsWith('.'))
        .map(async (e) => {
          const full = path.join(dirPath, e.name);
          let stat = null;
          try { stat = fs.statSync(full); } catch { /* stat 失敗時保留 null */ }
          const isDirFlag = e.isDirectory() || (stat && typeof stat.isDirectory === 'function' && stat.isDirectory());
          return {
            name: e.name,
            path: full,
            isDir: isDirFlag,
            size: isDirFlag ? 0 : (stat ? stat.size : 0),
            mtime: stat ? stat.mtimeMs : 0,
            ext: isDirFlag ? '' : path.extname(e.name).slice(1).toLowerCase(),
            fav: favorites.has(path.normalize(full)),
          };
        });
      Promise.all(jobs).then(resolve, reject);
    });
  });
}

/* ---------------- 開啟檔案（系統預設應用程式） ---------------- */

/** 文字類預覽允許的副檔名 */
const TEXT_PREVIEW_EXTS = new Set(['.txt', '.md', '.markdown', '.html', '.htm', '.xhtml']);
/** 預覽內容上限（2MB） */
const PREVIEW_MAX = 2 * 1024 * 1024;

function openWithDefault(p) {
  return new Promise((resolve, reject) => {
    const plat = process.platform;
    if (plat === 'linux' && isWSL()) {
      openWsl(p).then(resolve, reject);
      return;
    }
    let cmd, args;
    if (plat === 'darwin') { cmd = 'open'; args = [p]; }
    else if (plat === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '', p]; }
    else { cmd = 'xdg-open'; args = [p]; }
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', (e) => reject(new Error(`無法啟動 ${cmd}：${e.message}`)));
    child.on('spawn', () => { child.unref(); resolve(); });
  });
}

/* ---------------- HTTP 伺服器 ---------------- */

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);
    const q = url.searchParams;

    /* ===== API ===== */
    if (pathname.startsWith('/api/')) {
      if (req.method === 'GET') {
        switch (pathname) {
          case '/api/roots':
            return sendJson(res, 200, { roots: commonRoots() });

          case '/api/meta':
            return sendJson(res, 200, { platform: process.platform, isWSL: isWSL(), home: os.homedir() });

          case '/api/favorites':
            return sendJson(res, 200, { favorites: favoriteList() });

          case '/api/search/status': {
            if (searchStatusCache && Date.now() - searchStatusCache.at < 10000) {
              return sendJson(res, 200, searchStatusCache.data);
            }
            const statusData = await everythingStatus();
            searchStatusCache = { at: Date.now(), data: statusData };
            return sendJson(res, 200, statusData);
          }

          case '/api/search': {
            const query = (q.get('q') || '').trim();
            if (!query) return sendJson(res, 400, { error: '請輸入搜尋關鍵字' });
            const limit = Math.min(200, Math.max(1, parseInt(q.get('limit') || '50', 10) || 50));
            const folder = q.get('folder');
            const t0 = Date.now();
            let engine = 'local';
            let items = [];
            // WSL 專屬資料夾（非 /mnt）沒有被 Everything 索引 → 直接本機搜尋
            const folderIsWslOnly = folder && !folder.startsWith('/mnt/');
            if (fs.existsSync(ES_EXE) && !folderIsWslOnly) {
              try {
                items = await searchEverything(query, limit, folder);
                engine = 'everything';
              } catch {
                try { items = await searchLocal(query, limit, folder); }
                catch (e) { return sendJson(res, 500, { error: e.message }); }
              }
            } else {
              try { items = await searchLocal(query, limit, folder); }
              catch (e) { return sendJson(res, 500, { error: e.message }); }
            }
            return sendJson(res, 200, { engine, query, tookMs: Date.now() - t0, total: items.length, items });
          }

          case '/api/recent': {
            const days = Math.min(365, Math.max(1, parseInt(q.get('days') || '', 10) || RECENT_DEFAULT_DAYS));
            const key = `d${days}`;
            if (recentCache && recentCache.key === key && Date.now() - recentCache.at < 30000) {
              return sendJson(res, 200, recentCache.data);
            }
            const t0 = Date.now();
            const collected = [];
            const state = { scanned: 0 };
            const cutoff = Date.now() - days * 86400000;
            const roots = recentRoots();
            await Promise.all(roots.map((r) => scanRecent(r.p, cutoff, 0, r.depth, collected, state)));
            collected.sort((a, b) => b.mtime - a.mtime);
            const items = collected.slice(0, RECENT_MAX_ITEMS);
            const data = { days, cutoff, scanned: state.scanned, tookMs: Date.now() - t0, items };
            recentCache = { key, at: Date.now(), data };
            return sendJson(res, 200, data);
          }

          case '/api/preview': {
            const p = resolvePath(q.get('path'));
            if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return sendJson(res, 400, { error: '找不到檔案' });
            const ext = path.extname(p).toLowerCase();
            if (!TEXT_PREVIEW_EXTS.has(ext)) return sendJson(res, 400, { error: '此檔案類型不支援文字預覽' });
            const stat = fs.statSync(p);
            if (stat.size > PREVIEW_MAX) return sendJson(res, 413, { error: '檔案超過 2MB，無法預覽' });
            const content = fs.readFileSync(p, 'utf8');
            if (content.includes('\u0000')) return sendJson(res, 415, { error: '檔案疑似為二進位內容，無法預覽' });
            return sendJson(res, 200, {
              name: path.basename(p),
              ext,
              size: stat.size,
              mtime: stat.mtimeMs,
              content,
            });
          }

          case '/api/dirs': {
            const p = resolvePath(q.get('path'));
            const hidden = q.get('hidden') === '1';
            if (!isDir(p)) return sendJson(res, 400, { error: '不是有效的資料夾' });
            const entries = await readDirEntries(p, hidden);
            const dirs = entries.filter((e) => e.isDir).map((e) => ({ path: e.path, name: e.name }));
            return sendJson(res, 200, { dirs });
          }

          case '/api/files': {
            const p = resolvePath(q.get('path'));
            const hidden = q.get('hidden') === '1';
            if (!isDir(p)) return sendJson(res, 400, { error: '不是有效的資料夾' });
            const files = await readDirEntries(p, hidden);
            return sendJson(res, 200, { files });
          }

          case '/api/stat': {
            const p = resolvePath(q.get('path'));
            let stat;
            try { stat = fs.statSync(p); }
            catch { return sendJson(res, 200, { exists: false }); }
            return sendJson(res, 200, { exists: true, isDir: stat.isDirectory(), size: stat.size, mtime: stat.mtimeMs });
          }

          case '/api/download': {
            const p = resolvePath(q.get('path'));
            if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return sendJson(res, 400, { error: '找不到檔案' });
            const name = path.basename(p);
            res.writeHead(200, {
              'Content-Type': 'application/octet-stream',
              'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
              'Content-Length': fs.statSync(p).size,
            });
            fs.createReadStream(p).pipe(res);
            return;
          }

          case '/api/archive': {
            // 壓縮檔內容預覽（ZIP/TAR/RAR/7Z）
            let p;
            try { p = resolvePath(q.get('path') || ''); }
            catch { return sendJson(res, 400, { error: '缺少路徑' }); }
            if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return sendJson(res, 404, { error: '找不到檔案' });
            let entries;
            try { entries = await listArchiveEntries(p); }
            catch (e) { return sendJson(res, 500, { error: `無法讀取壓縮檔：${e.message}` }); }
            return sendJson(res, 200, {
              ok: true,
              name: path.basename(p),
              path: p,
              entries,
              count: entries.length,
              totalSize: entries.reduce((s, e) => s + (e.size || 0), 0),
            });
          }

          case '/api/zipfile': {
            const f = q.get('f') || '';
            const meta = pendingZips.get(f);
            if (!meta || !fs.existsSync(meta.file)) return sendJson(res, 404, { error: '壓縮檔已過期或不存在' });
            pendingZips.delete(f);
            const st = fs.statSync(meta.file);
            res.writeHead(200, {
              'Content-Type': 'application/zip',
              'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('批量下載.zip')}`,
              'Content-Length': st.size,
            });
            // 串流結束後才刪檔（避免 unlink 與 open 競態導致 ENOENT）
            const rs = fs.createReadStream(meta.file);
            rs.pipe(res);
            let cleaned = false;
            const clean = () => {
              if (cleaned) return;
              cleaned = true;
              try { fs.unlinkSync(meta.file); } catch { /* 忽略 */ }
            };
            res.on('error', () => rs.destroy());
            res.on('finish', clean);
            res.on('close', clean);
            return;
          }

          default:
            return sendJson(res, 404, { error: '未知 API' });
        }
      }

      if (req.method === 'POST' || req.method === 'DELETE') {
        const body = await readBody(req);
        switch (pathname) {
          case '/api/favorites': {
            const p = resolvePath(body.path);
            if (req.method === 'POST') {
              if (!isDir(p)) return sendJson(res, 400, { error: '不是有效的資料夾' });
              favorites.add(path.normalize(p));
            } else {
              favorites.delete(path.normalize(p));
            }
            saveFavorites();
            return sendJson(res, 200, { ok: true, favorites: favoriteList() });
          }

          case '/api/open': {
            const p = resolvePath(body.path);
            if (!fs.existsSync(p)) return sendJson(res, 400, { error: '找不到檔案' });
            await openWithDefault(p);
            return sendJson(res, 200, { ok: true, msg: '已嘗試以系統預設應用程式開啟' });
          }

          case '/api/copy': {
            const srcs = (Array.isArray(body.srcs) && body.srcs.length) ? body.srcs : (body.src ? [body.src] : []);
            if (!srcs.length) return sendJson(res, 400, { error: '缺少來源檔案' });
            const destDir = resolvePath(body.destDir);
            if (!isDir(destDir)) return sendJson(res, 400, { error: '目的地不是有效的資料夾' });
            const dests = [];
            const destNorm = destDir.replace(/[\\/]+$/, '');
            for (const s of srcs) {
              const src = resolvePath(s);
              if (!fs.existsSync(src)) continue;
              const srcNorm = src.replace(/[\\/]+$/, '');
              // 防護：目的地是來源本身或其子資料夾（避免把資料夾複製進自己而無限遞迴）
              if (srcNorm === destNorm || destNorm.startsWith(srcNorm + path.sep)) continue;
              const st = fs.statSync(src);
              const dest = await uniqueDest(destDir, path.basename(src));
              if (st.isDirectory()) await copyDir(src, dest);
              else await fsp.copyFile(src, dest);
              dests.push(dest);
            }
            return sendJson(res, 200, { ok: true, dest: dests[0] || '', dests, copied: dests.length });
          }

          case '/api/move': {
            const srcs = (Array.isArray(body.srcs) && body.srcs.length) ? body.srcs : (body.src ? [body.src] : []);
            if (!srcs.length) return sendJson(res, 400, { error: '缺少來源檔案' });
            const destDir = resolvePath(body.destDir);
            if (!isDir(destDir)) return sendJson(res, 400, { error: '目的地不是有效的資料夾' });
            const dests = [];
            const destNorm = destDir.replace(/[\\/]+$/, '');
            for (const s of srcs) {
              const src = resolvePath(s);
              if (!fs.existsSync(src)) continue;
              const srcNorm = src.replace(/[\\/]+$/, '');
              // 防護：目的地是來源本身或其子資料夾（搬移進自己內部無意義且會出錯）
              if (srcNorm === destNorm || destNorm.startsWith(srcNorm + path.sep)) continue;
              const st = fs.statSync(src);
              const dest = await uniqueDest(destDir, path.basename(src));
              try {
                await fsp.rename(src, dest);
              } catch (e) {
                if (e.code === 'EXDEV') { // 跨磁碟：複製＋刪除
                  if (st.isDirectory()) { await copyDir(src, dest); await fsp.rm(src, { recursive: true, force: true }); }
                  else { await fsp.copyFile(src, dest); await fsp.rm(src, { force: true }); }
                } else throw e;
              }
              dests.push(dest);
            }
            return sendJson(res, 200, { ok: true, dest: dests[0] || '', dests, moved: dests.length });
          }

          case '/api/backup': {
            // 備份範圍＝body.dir（目前資料夾）；選取項目為 paths／path（含子資料夾遞迴）
            const paths = (Array.isArray(body.paths) && body.paths.length) ? body.paths : (body.path ? [body.path] : []);
            if (!paths.length) return sendJson(res, 400, { error: '缺少檔案' });
            let scopeDir = null;
            if (body.dir && typeof body.dir === 'string' && body.dir.trim()) {
              try { scopeDir = resolvePath(body.dir); } catch { /* 略 */ }
            }
            if (!scopeDir || !isDir(scopeDir)) {
              try { scopeDir = path.dirname(resolvePath(paths[0])); } catch { /* 略 */ }
            }
            if (!scopeDir || !isDir(scopeDir)) return sendJson(res, 400, { error: '備份範圍（目前資料夾）無效' });

            // 1) 收集候選檔案：選取的檔案 ＋ 選取子資料夾遞迴內的所有檔案
            const candidates = await collectBackupFiles(scopeDir, paths);
            if (!candidates.length) {
              return sendJson(res, 200, { ok: true, skip: true, count: 0, message: '選取範圍內沒有可備份的檔案' });
            }

            // 2) 僅備份具有封存標記（A）的檔案
            const flagged = await filterArchiveFlagged(candidates);
            if (!flagged.length) {
              return sendJson(res, 200, { ok: true, skip: true, count: 0, message: '沒有具有封存標記（A）的檔案可備份' });
            }

            const bakDir = path.join(scopeDir, BAK_DIR);
            const hasBak = fs.existsSync(bakDir);
            const hist = hasBak ? loadBackupHistory(scopeDir) : null;
            const stamp = backupStamp();
            let mode, files, zipName, message;

            if (!hasBak || !hist) {
              // 3a) 全備份：.bak 不存在（或歷程遺失）→ 備份全部具標記檔案
              mode = 'full';
              files = flagged;
              zipName = `f-${stamp}.zip`;
            } else {
              // 3b) 差異備份：比對歷程記錄（大小＋內容 sha256 雜湊），找出新增或內容異動的檔案
              const changed = [];
              for (const f of flagged) {
                const rec = hist.files[f.rel];
                if (!rec || rec.size !== f.size) { changed.push(f); continue; }
                if (await sha256File(f.abs) !== rec.hash) changed.push(f);
              }
              files = changed;
              // 先清除來源已不存在的舊記錄（維持歷程準確，不影響差異判斷）
              let pruned = false;
              for (const k of Object.keys(hist.files)) {
                if (!fs.existsSync(path.join(scopeDir, k))) { delete hist.files[k]; pruned = true; }
              }
              if (!files.length) {
                if (pruned) saveBackupHistory(scopeDir, hist);
                return sendJson(res, 200, {
                  ok: true, skip: true, mode: 'incr', count: 0,
                  message: '無差異：所有具封存標記（A）的檔案內容皆與上次備份相同',
                });
              }
              mode = 'incr';
              zipName = `i-${stamp}.zip`;
            }

            // 4) 打包 ZIP 至 .bak 資料夾（deflate 壓縮；zip 內以目前資料夾為根、相對路徑為條目名）
            await fsp.mkdir(bakDir, { recursive: true });
            zipName = uniqueZipName(bakDir, zipName);
            const entries = files.map((f) => ({ zipName: f.rel, fsPath: f.abs }));
            const { buf, hashes } = buildZip(entries, { withHashes: true });
            fs.writeFileSync(path.join(bakDir, zipName), buf);

            // 5) 更新備份歷程記錄（記錄大小／修改時間／內容 sha256）
            const newHist = hist || { version: 2, backups: [], files: {} };
            for (const f of files) {
              newHist.files[f.rel] = { size: f.size, mtime: f.mtime, hash: hashes.get(f.rel) };
            }
            if (mode === 'full') {
              // 全備份：歷程僅保留本次備份的檔案
              const rels = new Set(files.map((f) => f.rel));
              for (const k of Object.keys(newHist.files)) if (!rels.has(k)) delete newHist.files[k];
            }
            newHist.backups.push({ file: zipName, type: mode, at: new Date().toISOString(), count: files.length });
            newHist.last = zipName;
            saveBackupHistory(scopeDir, newHist);

            // 6) 備份成功後清除封存標記（A），使下次僅備份新異動的檔案（Windows 磁碟）
            let cleared = 0;
            const winFiles = files.map((f) => toWindowsPath(f.abs)).filter(Boolean);
            if (winFiles.length) {
              try { cleared = await clearWinArchiveFlags(winFiles); }
              catch (e) { console.error('清除封存標記失敗：', e.message); }
            }

            message = mode === 'full'
              ? `全備份完成：已備份 ${files.length} 個檔案至 ${BAK_DIR}`
              : `差異備份完成：已備份 ${files.length} 個異動檔案至 ${BAK_DIR}`;
            return sendJson(res, 200, { ok: true, mode, zip: zipName, count: files.length, bak: bakDir, cleared, message });
          }

          case '/api/restore': {
            // 還原壓縮檔（ZIP/TAR/RAR/7Z）至 destDir（預設：.bak 的上一層＝原始備份目錄）
            let zipPath;
            try { zipPath = resolvePath(body.zip || ''); }
            catch { return sendJson(res, 400, { error: '缺少壓縮檔路徑' }); }
            if (!fs.existsSync(zipPath) || fs.statSync(zipPath).isDirectory()) {
              return sendJson(res, 400, { error: '找不到壓縮檔' });
            }
            let destDir;
            try { destDir = body.destDir ? resolvePath(body.destDir) : defaultRestoreDir(zipPath); }
            catch { return sendJson(res, 400, { error: '還原目標資料夾無效' }); }
            if (!isDir(destDir)) return sendJson(res, 400, { error: '還原目標資料夾無效' });
            const overwrite = body.overwrite !== false;
            let result;
            try { result = await extractArchive(zipPath, destDir, overwrite); }
            catch (e) { return sendJson(res, 500, { error: `還原失敗：${e.message}` }); }
            return sendJson(res, 200, {
              ok: true,
              restored: result.restored,
              skipped: result.skipped,
              errors: result.errors || [],
              destDir,
              zip: zipPath,
            });
          }

          case '/api/dedup': {
            // 重整：掃描目前資料夾與子目錄，列出內容相同的重複檔案（先比長度再比 sha256）
            let dir;
            try { dir = resolvePath(body.dir || ''); }
            catch { return sendJson(res, 400, { error: '缺少資料夾' }); }
            if (!isDir(dir)) return sendJson(res, 400, { error: '資料夾無效' });
            let groups;
            try { groups = await scanDuplicates(dir); }
            catch (e) { return sendJson(res, 500, { error: `掃描失敗：${e.message}` }); }
            const dupCount = groups.reduce((s, g) => s + g.files.length, 0);
            return sendJson(res, 200, { ok: true, dir, groups, groupCount: groups.length, dupCount });
          }

          case '/api/rename': {
            const src = resolvePath(body.path);
            const newName = String(body.newName || '').trim();
            if (!fs.existsSync(src)) return sendJson(res, 400, { error: '找不到檔案' });
            if (!newName || newName.includes('/') || newName.includes('\\')) return sendJson(res, 400, { error: '請輸入有效的檔名' });
            if (newName === '.' || newName === '..') return sendJson(res, 400, { error: '無效的檔名' });
            const dest = path.join(path.dirname(src), newName);
            // Windows 檔案系統（/mnt）存在檢查不分大小寫：僅大小寫變更時允許
            const caseOnly = dest.toLowerCase() === src.toLowerCase() && dest.length === src.length;
            if (fs.existsSync(dest) && !caseOnly) return sendJson(res, 409, { error: `「${newName}」已存在` });
            try {
              await fsp.rename(src, dest);
            } catch (e) {
              return sendJson(res, 500, { error: `更名失敗：${e.message}` });
            }
            return sendJson(res, 200, { ok: true, path: dest, name: newName });
          }

          case '/api/delete': {
            const paths = (Array.isArray(body.paths) && body.paths.length) ? body.paths : (body.path ? [body.path] : []);
            if (!paths.length) return sendJson(res, 400, { error: '缺少路徑' });
            let deleted = 0;
            for (const p of paths) {
              const full = resolvePath(p);
              if (!fs.existsSync(full)) continue;
              await fsp.rm(full, { recursive: true, force: true });
              deleted++;
            }
            return sendJson(res, 200, { ok: true, deleted });
          }

          case '/api/zip': {
            const paths = Array.isArray(body.paths) ? body.paths : [];
            if (!paths.length) return sendJson(res, 400, { error: '請先選取項目' });
            const entries = [];
            for (const p of paths) collectZipEntries(resolvePath(p), '', entries);
            const buf = buildZip(entries);
            prunePendingZips();
            const token = `fm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.zip`;
            const file = path.join(os.tmpdir(), token);
            fs.writeFileSync(file, buf);
            pendingZips.set(token, { at: Date.now(), file });
            return sendJson(res, 200, {
              ok: true,
              url: `/api/zipfile?f=${token}`,
              name: `批量下載_${paths.length}項.zip`,
              fileCount: entries.filter((e) => e.fsPath).length,
            });
          }

          default:
            return sendJson(res, 404, { error: '未知 API' });
        }
      }
      return sendJson(res, 405, { error: '不支援的請求方法' });
    }

    /* ===== 靜態檔案 ===== */
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.normalize(filePath).replace(/^([/\\])+/, '');
    const full = path.join(PUBLIC, filePath);
    if (full !== PUBLIC && !full.startsWith(PUBLIC + path.sep)) {
      return sendJson(res, 403, { error: '禁止存取' });
    }
    fs.stat(full, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('404 Not Found');
      }
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(full).pipe(res);
    });
  } catch (e) {
    sendJson(res, 500, { error: e.message || '伺服器錯誤' });
  }
});

loadFavorites();

server.listen(PORT, HOST, () => {
  console.log('📁 Vue 本機檔案管理系統已啟動');
  console.log(`   ➜ 本機瀏覽:   http://localhost:${PORT}`);
  if (WSL) {
    console.log(`   ➜ Windows 端: http://localhost:${PORT} 或 http://<WSL-IP>:${PORT}`);
    try {
      const ip = require('os').networkInterfaces();
      for (const list of Object.values(ip)) {
        for (const info of list || []) {
          if (info.family === 'IPv4' && !info.internal) {
            console.log(`   ➜ WSL IP 存取: http://${info.address}:${PORT}`);
            break;
          }
        }
      }
    } catch { /* 忽略 */ }
  }
});
