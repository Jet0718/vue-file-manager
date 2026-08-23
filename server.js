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

/** 備份專用檔名：name_YYYYMMDD_HHmmss.ext */
function backupName(name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${base}_${stamp}${ext}`;
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

/** 建立 ZIP（store 模式）Buffer */
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const enc = new TextEncoder();
  const dt = dosDateTime(new Date());
  for (const e of entries) {
    const nameBytes = enc.encode(e.zipName);
    const data = e.fsPath ? fs.readFileSync(e.fsPath) : Buffer.alloc(0);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);       // version needed
    local.writeUInt16LE(0x0800, 6);   // flag：UTF-8 檔名
    local.writeUInt16LE(0, 8);        // method：store
    local.writeUInt16LE(dt.time, 10);
    local.writeUInt16LE(dt.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(dt.time, 12);
    cd.writeUInt16LE(dt.date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(e.fsPath ? 0 : 0x10, 38); // external attrs（資料夾標記）
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBytes);
    offset += local.length + nameBytes.length + data.length;
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
  return Buffer.concat([...chunks, ...central, eocd]);
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
            // 預設備份至「各檔案所在資料夾」下的 bak 子資料夾
            const paths = (Array.isArray(body.paths) && body.paths.length) ? body.paths : (body.path ? [body.path] : []);
            if (!paths.length) return sendJson(res, 400, { error: '缺少檔案' });
            const results = [];
            for (const p of paths) {
              const src = resolvePath(p);
              if (!fs.existsSync(src) || fs.statSync(src).isDirectory()) continue;
              const dir = path.dirname(src);
              const bak = path.join(dir, 'bak');
              await fsp.mkdir(bak, { recursive: true });
              let dest = path.join(bak, path.basename(src));
              if (fs.existsSync(dest)) dest = path.join(bak, backupName(path.basename(src)));
              await fsp.copyFile(src, dest);
              results.push(dest);
            }
            return sendJson(res, 200, { ok: true, results, backedUp: results.length });
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
